// Upload-Warteschlange für alle Ziele (Ordner, Nextcloud …).
//
// Läuft im Hintergrund der App weiter, egal welche Seite offen ist. Der Zustand steht in
// upload_items/upload_batches (überlebt einen Neustart); Fortschritt und Geschwindigkeit nur
// im Arbeitsspeicher. Seiten hören auf das Ereignis "uploads:changed".
//
// Reihenfolge: kleinste "position" zuerst. Beim Einreihen gilt Wärmebilder → Vergleichsbilder →
// Sichtbilder – über alle Aufträge hinweg, damit Wichtiges schnell bei den Kameraden ist.

import { db } from '/lib/db.js'
import Setting from '/app/models/setting.js'
import UploadBatch from '/app/models/upload_batch.js'
import UploadItem from '/app/models/upload_item.js'
import { TARGETS } from '/app/services/upload_targets.js'

const CONCURRENCY = 2
const RETRY_DELAYS = [10_000, 30_000, 60_000] // Netzwerkfehler: automatisch erneut versuchen
const SPEED_WINDOW = 6000
const CATEGORY_BASE = 1e13 // position = Rang · 1e13 + Zeitpunkt → Kategorie vor Alter

const items = new Map() // id → UploadItem (aktive und kürzlich erledigte)
const batches = new Map() // id → UploadBatch
const running = new Map() // id → { done, intent, transferId }
const retries = new Map() // id → { count, notBefore }
const samples = [] // { t, bytes } – kumulierte Bytes für die Geschwindigkeit
let transferred = 0
let sessionStart = null // Beginn der aktuellen "Runde" (für die Gesamtanzeige)
let started = false
let emitTimer = null
let retryTimer = null

const now = () => new Date().toISOString()
const isActive = (item) => UploadItem.ACTIVE.includes(item.status)

function emit({ immediate = false } = {}) {
  if (immediate) {
    clearTimeout(emitTimer)
    emitTimer = null
    return window.dispatchEvent(new CustomEvent('uploads:changed'))
  }
  emitTimer ??= setTimeout(() => {
    emitTimer = null
    window.dispatchEvent(new CustomEvent('uploads:changed'))
  }, 250)
}

async function persist(item, fields) {
  Object.assign(item, fields)
  const keys = Object.keys(fields)
  await db.execute(
    `UPDATE upload_items SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
    [...keys.map((k) => (typeof fields[k] === 'boolean' ? Number(fields[k]) : fields[k])), now(), item.id],
  )
}

// ── Start ────────────────────────────────────────────────────────────────

// Beim App-Start: Unterbrochenes wieder einreihen und weitermachen
export async function start() {
  if (started) return
  started = true
  await db.execute(`UPDATE upload_items SET status = 'queued' WHERE status = 'running'`)
  const cleared = Setting.get('uploads.cleared_at') ?? ''
  const rows = await UploadItem.where(
    `status IN ('queued', 'paused', 'failed') OR (finished_at > ? AND finished_at > datetime('now', '-12 hours'))`,
    [cleared],
    { order: 'position ASC' },
  )
  for (const item of rows) items.set(item.id, item)
  await loadBatches([...new Set(rows.map((i) => i.batch_id))])
  if (rows.some(isActive)) sessionStart = Math.min(...rows.filter(isActive).map((i) => Date.parse(i.created_at) || Date.now()))
  emit()
  kick()
}

async function loadBatches(ids) {
  const missing = ids.filter((id) => !batches.has(id))
  if (!missing.length) return
  for (const batch of await UploadBatch.where(`id IN (${missing.map(() => '?').join(',')})`, missing)) batches.set(batch.id, batch)
}

// ── Einreihen ────────────────────────────────────────────────────────────

// entries: [{ media_file_id?, comparison_id?, category, variant, viewpoint_id, source_path, file_name, size }]
export async function enqueue({ mission, assignment, target, destination, label, entries }) {
  if (!entries.length) return null
  const batch = await UploadBatch.create({ mission_id: mission.id, assignment_id: assignment?.id, target, destination, label })
  batches.set(batch.id, batch)
  const t = Date.now()
  const rank = (c) => Math.max(0, UploadItem.CATEGORY_ORDER.indexOf(c))
  const sorted = [...entries].sort((a, b) => rank(a.category) - rank(b.category))
  const stamp = now()
  // Eine Anweisung für alle Dateien (schneller als einzeln)
  const columns = ['batch_id', 'mission_id', 'assignment_id', 'target', 'media_file_id', 'comparison_id', 'category', 'variant',
    'viewpoint_id', 'source_path', 'dest_path', 'size', 'position', 'status', 'created_at', 'updated_at']
  for (let start = 0; start < sorted.length; start += 50) {
    const chunk = sorted.slice(start, start + 50)
    const values = chunk.flatMap((e, i) => [
      batch.id, mission.id, assignment?.id ?? null, target, e.media_file_id ?? null, e.comparison_id ?? null, e.category, e.variant ?? null,
      e.viewpoint_id ?? null, e.source_path, TARGETS[target].join(destination, e.file_name), e.size ?? 0,
      rank(e.category) * CATEGORY_BASE + t + (start + i) / 1000, 'queued', stamp, stamp,
    ])
    await db.execute(
      `INSERT INTO upload_items (${columns.join(', ')}) VALUES ${chunk.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ')}`,
      values,
    )
  }
  if (![...items.values()].some(isActive)) sessionStart = Date.now()
  for (const item of await UploadItem.where('batch_id = ?', [batch.id], { order: 'position ASC' })) items.set(item.id, item)
  emit({ immediate: true })
  kick()
  return batch
}

// ── Abarbeiten ───────────────────────────────────────────────────────────

function nextItems() {
  const t = Date.now()
  return [...items.values()]
    .filter((i) => i.status === 'queued' && !running.has(i.id) && (retries.get(i.id)?.notBefore ?? 0) <= t)
    .sort((a, b) => a.position - b.position)
}

function kick() {
  for (const item of nextItems()) {
    if (running.size >= CONCURRENCY) break
    run(item)
  }
  // Wartende Wiederholungen später anstoßen
  clearTimeout(retryTimer)
  const waits = [...retries.values()].map((r) => r.notBefore - Date.now()).filter((ms) => ms > 0)
  if (waits.length) retryTimer = setTimeout(kick, Math.min(...waits) + 50)
}

async function run(item) {
  const target = TARGETS[item.target]
  const transferId = `upload-${item.id}`
  const job = { done: 0, intent: null, transferId, startedAt: Date.now() }
  running.set(item.id, job)
  await persist(item, { status: 'running', started_at: now(), error: null })
  emit()

  let fields
  try {
    if (!target) throw new Error(`Unbekanntes Ziel: ${item.target}`)
    if (job.intent) throw new Error('CANCELED') // während des Starts pausiert/verschoben
    await refreshSource(item)
    const result = await target.transfer(item, transferId, ({ done }) => {
      transferred += Math.max(0, done - job.done)
      job.done = done
      samples.push({ t: Date.now(), bytes: transferred })
      emit()
    })
    retries.delete(item.id)
    fields = { status: 'done', skipped: !!result?.skipped, finished_at: now() }
    // Unter Ausweichnamen abgelegt (am Ziel lag eine andere Datei gleichen Namens)
    if (result?.name) fields.dest_path = `${item.dest_path.slice(0, item.dest_path.search(/[^\\/]*$/))}${result.name}`
    if (!result?.skipped) rememberSpeed(item, (Date.now() - job.startedAt) / 1000)
  } catch (error) {
    const message = String(error?.message ?? error)
    if (job.intent || message.includes('CANCELED')) {
      fields = { status: job.intent ?? 'paused' }
    } else {
      const attempt = (retries.get(item.id)?.count ?? 0) + 1
      const delay = RETRY_DELAYS[attempt - 1]
      const transient = /nicht erreichbar|Verbindung|Status 5\d\d|gesperrt/.test(message)
      if (transient && delay) {
        retries.set(item.id, { count: attempt, notBefore: Date.now() + delay })
        fields = { status: 'queued', error: `${message} – neuer Versuch in ${delay / 1000} s` }
      } else {
        retries.delete(item.id)
        fields = { status: 'failed', error: message }
      }
    }
  }
  running.delete(item.id)
  await persist(item, fields)
  if (![...items.values()].some(isActive)) sessionEnded()
  emit({ immediate: true })
  kick()
}

function sessionEnded() {
  // Gesamtanzeige bleibt kurz auf "fertig", danach beginnt beim nächsten Einreihen eine neue Runde
  setTimeout(() => {
    if (![...items.values()].some(isActive)) {
      sessionStart = null
      emit()
    }
  }, 60_000)
}

// Durchschnittliche Geschwindigkeit je Ziel merken (für Schätzungen vor dem Hochladen)
function rememberSpeed(item, seconds) {
  if (!item.size || item.size < 300_000 || seconds <= 0) return
  const key = `uploads.speed_${item.target}`
  const measured = item.size / seconds
  const previous = Setting.get(key)
  Setting.set(key, Math.round(previous ? previous * 0.6 + measured * 0.4 : measured))
}

// Dateien können nach dem Einreihen umbenannt worden sein (Wegpunkt "Draufsicht" → "Draufsicht_1",
// Auftrag/Einsatz umbenannt). Daher direkt vor dem Hochladen den aktuellen Pfad nachlesen und
// den Zielpfad mitziehen: Das Ziel spiegelt die letzten Teile des lokalen Pfads
// (Nextcloud: Auftragsordner/Datei, Ordner-Export: Einsatzordner/Auftragsordner/Datei).
async function refreshSource(item) {
  const [row] = item.media_file_id
    ? await db.select('SELECT path FROM media_files WHERE id = ?', [item.media_file_id])
    : item.comparison_id ? await db.select('SELECT path FROM comparisons WHERE id = ?', [item.comparison_id]) : []
  if (!row?.path || row.path === item.source_path) return
  const depth = TARGETS[item.target]?.mirrorDepth ?? 1
  const source = row.path.split(/[\\/]/)
  const dest = item.dest_path.split(/[\\/]/)
  dest.splice(-depth, depth, ...source.slice(-depth))
  await persist(item, { source_path: row.path, dest_path: dest.join('/') })
}

// ── Steuern ──────────────────────────────────────────────────────────────

const find = (id) => items.get(Number(id))

async function interrupt(item, intent) {
  const job = running.get(item.id)
  if (!job) return false
  job.intent = intent
  await TARGETS[item.target]?.cancel(job.transferId)
  return true
}

export async function pause(id) {
  const item = find(id)
  if (!item || !isActive(item) || item.status === 'paused') return
  retries.delete(item.id)
  if (!(await interrupt(item, 'paused'))) await persist(item, { status: 'paused' })
  emit({ immediate: true })
}

export async function resume(id) {
  const item = find(id)
  if (!item || !['paused', 'failed'].includes(item.status)) return
  retries.delete(item.id)
  await persist(item, { status: 'queued', error: null })
  if (!sessionStart) sessionStart = Date.now()
  emit({ immediate: true })
  kick()
}

export async function cancel(id) {
  const item = find(id)
  if (!item || !isActive(item)) return
  retries.delete(item.id)
  if (!(await interrupt(item, 'canceled'))) await persist(item, { status: 'canceled', finished_at: now() })
  if (![...items.values()].some(isActive)) sessionEnded()
  emit({ immediate: true })
}

const activePositions = () => [...items.values()].filter(isActive).map((i) => i.position)

// An den Anfang: läuft als Nächstes (pausierte werden dabei fortgesetzt)
export async function moveToFront(id) {
  const item = find(id)
  if (!item || !isActive(item)) return
  retries.delete(item.id)
  const fields = { position: Math.min(...activePositions()) - 1 }
  if (['paused', 'failed'].includes(item.status)) Object.assign(fields, { status: 'queued', error: null })
  await persist(item, fields)
  // Volle Leitung → den hintersten laufenden Upload zurückstellen, damit dieser sofort startet
  if (!running.has(item.id) && running.size >= CONCURRENCY) {
    const last = [...running.keys()].map(find).sort((a, b) => b.position - a.position)[0]
    if (last) await interrupt(last, 'queued')
  }
  emit({ immediate: true })
  kick()
}

// Ans Ende: ein laufender Upload wird angehalten und kommt dran, wenn er an der Reihe ist
export async function moveToEnd(id) {
  const item = find(id)
  if (!item || !isActive(item)) return
  await persist(item, { position: Math.max(...activePositions()) + 1 })
  await interrupt(item, 'queued')
  emit({ immediate: true })
  kick()
}

export async function pauseAll() {
  for (const item of [...items.values()].filter((i) => ['queued', 'running'].includes(i.status))) await pause(item.id)
}

export async function resumeAll() {
  for (const item of [...items.values()].filter((i) => ['paused', 'failed'].includes(i.status))) await resume(item.id)
}

export async function retryFailed() {
  for (const item of [...items.values()].filter((i) => i.status === 'failed')) await resume(item.id)
}

export async function cancelBatch(batchId) {
  for (const item of [...items.values()].filter((i) => i.batch_id === Number(batchId) && isActive(i))) await cancel(item.id)
}

// Erledigte aus der Liste entfernen (bleiben in der Datenbank – für „zuletzt bereitgestellt“)
export async function clearFinished() {
  for (const [id, item] of items) if (!isActive(item)) items.delete(id)
  await Setting.set('uploads.cleared_at', now())
  emit({ immediate: true })
}

// ── Lesen ────────────────────────────────────────────────────────────────

export function speed() {
  const t = Date.now()
  while (samples.length && samples[0].t < t - SPEED_WINDOW) samples.shift()
  if (!running.size || samples.length < 2) return 0
  const first = samples[0]
  const last = samples[samples.length - 1]
  return last.t > first.t ? ((last.bytes - first.bytes) / (last.t - first.t)) * 1000 : 0
}

export const rememberedSpeed = (target) => Setting.get(`uploads.speed_${target}`) ?? null

// Geschätzte Dauer in Sekunden für eine Datenmenge (null = noch keine Erfahrung)
export function estimateSeconds(target, bytes) {
  const bps = rememberedSpeed(target)
  return bps ? bytes / bps : null
}

export const progressOf = (item) => (item.status === 'done' ? item.size : running.get(item.id)?.done ?? 0)

// Für Seitenleiste und Übersicht
export function summary() {
  const all = [...items.values()]
  const session = all.filter((i) => isActive(i) || (i.status === 'done' && sessionStart && Date.parse(i.finished_at) >= sessionStart - 1000))
  const pending = all.filter((i) => ['queued', 'running'].includes(i.status))
  const total = session.reduce((s, i) => s + (i.size || 0), 0)
  const done = session.reduce((s, i) => s + (progressOf(i) || 0), 0)
  const remaining = pending.reduce((s, i) => s + Math.max(0, (i.size || 0) - progressOf(i)), 0)
  const bps = speed()
  let eta = bps > 0 ? remaining / bps : null
  if (eta == null && remaining) {
    // Noch keine Messung in dieser Runde → aus früheren Uploads schätzen
    eta = pending.reduce((s, i) => s + (estimateSeconds(i.target, Math.max(0, (i.size || 0) - progressOf(i))) ?? NaN), 0)
    if (Number.isNaN(eta)) eta = null
  }
  const count = (status) => all.filter((i) => i.status === status).length
  return {
    visible: !!sessionStart || all.some(isActive),
    total, done, remaining, speed: bps, eta,
    files: session.length,
    filesDone: session.filter((i) => i.status === 'done').length,
    queued: count('queued'), running: count('running'), paused: count('paused'), failed: count('failed'),
    finished: !all.some(isActive) && session.length > 0,
  }
}

// Alle Einträge für die Übersicht: aktive in Warteschlangen-Reihenfolge, danach erledigte
export function list() {
  const all = [...items.values()]
  const order = { running: 0, queued: 1, paused: 1, failed: 1 }
  const active = all.filter(isActive).sort((a, b) => (order[a.status] - order[b.status]) || a.position - b.position)
  const finished = all.filter((i) => !isActive(i)).sort((a, b) => (b.finished_at ?? '').localeCompare(a.finished_at ?? ''))
  return { active, finished, batches, retries }
}

// Bytes, die vor einem neuen Upload noch in der Warteschlange liegen (je Ziel)
export function pendingBytes(target) {
  return [...items.values()]
    .filter((i) => i.target === target && ['queued', 'running'].includes(i.status))
    .reduce((s, i) => s + Math.max(0, (i.size || 0) - progressOf(i)), 0)
}
