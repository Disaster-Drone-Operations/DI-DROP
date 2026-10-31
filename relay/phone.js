// Phone page: pairing via QR fragment, then either determine and send the location,
// (mode "image") receive an image from di-drop and save it to the photos, or
// (mode "control") act as remote control for di-drop's training mode.
// The texts shown on the page are German (UI).
import {
  parsePairingFragment, sessionSocketUrl, createChannel, positionFromGeolocation, send, sha256B64url, VERSION,
  CHUNK_BYTES, MAX_IMAGE_BYTES,
} from '/protocol.js'

const view = document.getElementById('view')
// Remote control: keep the pairing for this tab, so it reconnects after a reload / screen lock
const CONTROL_STORAGE = 'didrop-control'
let pairing = parsePairingFragment(location.hash)
try {
  if (pairing?.mode === 'control') sessionStorage.setItem(CONTROL_STORAGE, JSON.stringify(pairing))
  else if (!pairing) pairing = JSON.parse(sessionStorage.getItem(CONTROL_STORAGE) ?? 'null')
} catch {
  // without session storage: no automatic reconnect
}
// Remove the secret from the address bar immediately (not in history, not when sharing)
history.replaceState(null, '', location.pathname)
// New QR code opened in the same browser page → restart with the new code
addEventListener('hashchange', () => location.reload())

let ws = null
let channel = null
let watchId = null
let sentCount = 0
let lastAccuracy = null
let image = null // { transferId, name, mime, size, sha256, chunks, parts: [], received }
const imageMode = pairing?.mode === 'image'
const controlMode = pairing?.mode === 'control'
let controlState = null // { title, clock, next, done, total, cards, remote } from di-drop
let receivedAt = 0
let ended = false
let retries = 0

if (controlMode) {
  document.title = 'di-drop · Fernbedienung'
  document.body.classList.add('remote-mode')
  document.querySelector('footer').textContent =
    'Fernbedienung für den Schulungsmodus. Befehle gehen verschlüsselt direkt an di-drop. Bitte diese Seite geöffnet lassen.'
}

if (imageMode) {
  document.title = 'di-drop · Bild empfangen'
  document.querySelector('footer').textContent =
    'Das Bild wird verschlüsselt direkt von di-drop übertragen. Der Vermittlungsserver kann es nicht sehen und speichert nichts.'
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function render(state, { title, text = '', button = null, secondary = null, facts = '', progress = null, imageUrl = null } = {}) {
  view.className = `state-${state}`
  view.innerHTML = `
    ${state === 'busy' ? '<div class="spinner"></div>' : ''}
    ${imageUrl ? `<img class="received" src="${esc(imageUrl)}" alt="">` : ''}
    <h1>${title}</h1>
    ${progress != null ? `<progress max="100" value="${progress}"></progress>` : ''}
    ${text ? `<p>${text}</p>` : ''}
    ${facts ? `<div class="facts">${facts}</div>` : ''}
    ${button ? `<button class="big" id="primary">${esc(button.label)}</button>` : ''}
    ${secondary ? `<button class="big secondary" id="secondary">${esc(secondary.label)}</button>` : ''}`
  if (button) view.querySelector('#primary').onclick = button.action
  if (secondary) view.querySelector('#secondary').onclick = secondary.action
}

const ERRORS = {
  NO_RECEIVER: 'di-drop ist nicht verbunden. Bitte in di-drop einen neuen QR-Code anzeigen lassen.',
  SESSION_EXPIRED: 'Dieser QR-Code ist abgelaufen. Bitte in di-drop einen neuen anzeigen lassen.',
  ALREADY_PAIRED: 'Mit diesem QR-Code ist schon ein anderes Gerät verbunden.',
  UNAUTHORIZED: 'Die Kopplung wurde abgelehnt. Bitte den QR-Code erneut scannen.',
  DESKTOP_GONE: 'Verbindung zu di-drop unterbrochen. Geht es nicht gleich weiter: in di-drop neu starten und den QR-Code erneut scannen.',
  RATE_LIMITED: 'Zu viele Nachrichten – bitte kurz warten.',
  DECRYPT_FAILED: controlMode ? 'Eine Nachricht konnte nicht entschlüsselt werden. Bitte den QR-Code erneut scannen.' : 'Das Bild kam beschädigt an. Bitte in di-drop erneut senden.',
  IMAGE_INVALID: 'Das Bild kam unvollständig an. Bitte in di-drop erneut senden.',
}

function fail(code, detail) {
  stopWatch()
  render('error', { title: 'Verbindung nicht möglich', text: esc(ERRORS[code] ?? detail ?? code) })
}

// ── Connection ───────────────────────────────────────────────────────────────

async function connect() {
  if (!pairing) {
    return render('error', { title: 'Kein QR-Code', text: 'Bitte den QR-Code in di-drop mit der Kamera scannen.' })
  }
  if (!imageMode && !controlMode && !navigator.geolocation) {
    return render('error', { title: 'Kein Standort verfügbar', text: 'Dieser Browser unterstützt keine Standortbestimmung.' })
  }
  if (!controlState) render('busy', { title: 'Verbinde mit di-drop …' })
  channel = await createChannel({ ...pairing, role: 'phone' })
  ws = new WebSocket(sessionSocketUrl(location.origin, pairing.sessionId))
  ws.binaryType = 'arraybuffer'

  ws.onopen = async () => {
    send(ws, { type: 'hello', role: 'phone' })
    // Pairing proof: only someone who knows the secret from the QR code can create it
    ws.send(JSON.stringify(await channel.seal({ type: 'pair', ts: Date.now() })))
  }
  // Messages are processed strictly one after another (image blocks must stay in order)
  let queue = Promise.resolve()
  ws.onmessage = (event) => {
    queue = queue
      .then(() => (typeof event.data === 'string' ? handle(JSON.parse(event.data)) : receiveChunk(event.data)))
      .catch((e) => {
        if (image) sendSealed({ type: 'image-error', transferId: image.transferId, code: e.code ?? 'IMAGE_INVALID' }).catch(() => {})
        image = null
        fail(e.code ?? 'INVALID_MESSAGE', e.message)
      })
  }
  ws.onclose = () => {
    if (controlMode && !ended) return reconnectControl()
    // After "Fertig"/"✓ übertragen" (done/sent) closing the connection is not an error
    if (!view.classList.contains('state-error') && !view.classList.contains('state-ok')) render('error', { title: 'Verbindung beendet', text: 'Zum erneuten Senden den QR-Code in di-drop neu scannen.' })
    stopWatch()
  }
}

async function handle(msg) {
  if (msg.v !== VERSION) return
  if (msg.type === 'paired') {
    retries = 0
    return controlState ? renderControl() : render('busy', { title: 'Verbunden', text: imageMode ? 'Warte auf das Bild …' : 'Warte auf di-drop …' })
  }
  if (msg.type === 'error' && controlMode) return controlError(msg.code, msg.message)
  if (msg.type === 'error') return fail(msg.code, msg.message)
  if (msg.type === 'close' && controlMode) return endControl()
  if (msg.type === 'close') return view.classList.contains('state-ok') ? undefined : render('ok', { title: 'Fertig', text: 'di-drop hat die Übertragung beendet. Du kannst diese Seite schließen.' })
  if (msg.type !== 'data') return

  const payload = await channel.open(msg)
  if (payload.type === 'state' && controlMode) {
    controlState = payload.state
    receivedAt = Date.now()
    keepAwake()
    return renderControl()
  }
  if (payload.type === 'image-offer' && imageMode) return startImage(payload)
  if (payload.type === 'request' && payload.mode === 'single') return askSingle()
  if (payload.type === 'request' && payload.mode === 'stream') return askStream()
  if (payload.type === 'stop') {
    stopWatch()
    await sendSealed({ type: 'status', state: 'stopped' })
    return render('ok', { title: 'Live-Übertragung beendet', text: 'di-drop hat die Übertragung gestoppt.' })
  }
  if (payload.type === 'ack' && watchId == null) {
    return render('ok', {
      title: '✓ Standort übertragen',
      text: 'di-drop hat deinen Standort empfangen. Du kannst diese Seite schließen.',
      facts: lastAccuracy != null ? `Genauigkeit ± ${Math.round(lastAccuracy)} m` : '',
    })
  }
}

const sendSealed = async (payload) => ws.send(JSON.stringify(await channel.seal(payload)))

// ── Remote control (training mode) ──────────────────────────────────────────

const pad = (n) => String(n).padStart(2, '0')
const hhmm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }

function simulatedNow() {
  const { at, speed, running } = controlState.clock
  return at + (running ? (Date.now() - receivedAt) * speed : 0)
}

function renderControl(notice = '') {
  if (!controlState) return
  const s = controlState
  const button = (cmd, label, { primary = false, data = {} } = {}) =>
    `<button class="btn ${primary ? 'primary' : ''}" data-cmd="${esc(cmd)}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}>${esc(label)}</button>`
  view.className = 'state-remote'
  view.innerHTML = `
    <div class="remote-head"><span class="badge">Schulung</span><strong>${esc(s.title)}</strong></div>
    ${notice ? `<div class="remote-notice">${esc(notice)}</div>` : ''}
    <div class="remote-clock"><div id="clock"></div><div id="clock-info" class="muted"></div></div>
    <div class="row">
      ${button(s.clock.running ? 'clock.pause' : 'clock.play', s.clock.running ? 'Anhalten' : 'Uhr starten', { primary: !s.clock.running })}
      ${[1, 10, 60].map((speed) => button('clock.speed', `${speed}×`, { primary: s.clock.speed === speed, data: { speed } })).join('')}
    </div>
    <div class="row">${button('clock.add', '+5 min', { data: { minutes: 5 } })}${button('clock.add', '+15 min', { data: { minutes: 15 } })}</div>
    <div class="remote-next">
      ${s.next
        ? `<div class="label">Als Nächstes${s.next.at ? ` · ${hhmm(s.next.at)} Uhr` : ''} · ${s.done + 1}/${s.total}</div>
           <strong>${esc(s.next.label)}</strong>
           <div class="row">${button('step.run', 'Ausführen', { primary: true })}${s.next.at && s.next.at > simulatedNow() ? button('step.forward', 'Vorspulen') : ''}${button('step.skip', 'Überspringen')}</div>`
        : `<div class="label">Drehbuch</div><strong>${s.total ? 'Alle Schritte erledigt.' : 'Kein Drehbuch.'}</strong>`}
    </div>
    ${s.cards.length ? `<h2>SD-Karten</h2>${s.cards.map((c) => `
      <div class="remote-device ${c.inserted ? 'on' : ''}"><span>${esc(c.label)}</span>
        ${button(c.inserted ? 'card.remove' : 'card.insert', c.inserted ? 'Entnehmen' : 'Einstecken', { primary: !c.inserted, data: { card: c.id } })}</div>`).join('')}` : ''}
    ${s.remote ? `<h2>Fernsteuerung</h2>
      <div class="remote-device ${s.remote.connected ? 'on' : ''}"><span>${esc(s.remote.name)}<br><small class="muted">${s.remote.flown} von ${s.remote.total} Flügen geflogen</small></span>
        ${button(s.remote.connected ? 'remote.disconnect' : 'remote.connect', s.remote.connected ? 'Trennen' : 'Anschließen', { primary: !s.remote.connected })}</div>` : ''}
    ${renderLocation(s.location)}`
  tickClock()
}

// Simulated phone of the participants: di-drop shows a QR code for the location → "scan" it here
function renderLocation(loc) {
  const button = (cmd, label, primary = false) => `<button class="btn ${primary ? 'primary' : ''}" data-cmd="${cmd}">${label}</button>`
  if (loc && loc.status === 'waiting') {
    return `<h2>Telefon der Teilnehmer</h2>
      <div class="remote-device on"><span>QR-Code für ${loc.mode === 'stream' ? 'den Live-Standort' : 'den Standort'} wird gezeigt</span>${button('location.scan', 'Scannen', true)}</div>
      <div class="remote-device"><span class="muted">Standortzugriff verweigern</span>${button('location.deny', 'Verweigern')}</div>`
  }
  if (loc && ['pairing', 'paired', 'streaming'].includes(loc.status)) {
    return `<h2>Telefon der Teilnehmer</h2>
      <div class="remote-device on"><span>${loc.status === 'streaming' ? 'Sendet Live-Standort' : 'Verbindet …'}</span>${loc.mode === 'stream' ? button('location.stop', 'Beenden') : ''}</div>`
  }
  return `<h2>Telefon der Teilnehmer</h2><div class="remote-device"><span class="muted">Zeigt di-drop einen QR-Code für den Standort, lässt er sich hier scannen.</span></div>`
}

function tickClock() {
  if (!controlState) return
  const d = new Date(simulatedNow())
  const clock = document.getElementById('clock')
  if (clock) clock.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  const info = document.getElementById('clock-info')
  const { speed, running } = controlState.clock
  if (info) info.textContent = `${d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}${running ? (speed > 1 ? ` · Zeitraffer ${speed}×` : '') : ' · angehalten'}`
}
setInterval(tickClock, 250)

view.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-cmd]')
  if (!target || !controlMode || ws?.readyState !== WebSocket.OPEN) return
  const { cmd, ...args } = target.dataset
  target.disabled = true // until the new state arrives
  await sendSealed({ type: 'command', action: cmd, ...args }).catch(() => {})
})

// Connection lost (screen off, dead zone, di-drop reloaded) → come back with the same pairing
function reconnectControl() {
  const delay = [1000, 2000, 5000, 10_000][Math.min(retries++, 3)]
  if (controlState) renderControl('Verbindung unterbrochen – verbinde neu …')
  else render('busy', { title: 'Verbinde neu …' })
  setTimeout(() => !ended && connect(), delay)
}

function controlError(code, message) {
  // di-drop is briefly gone (e.g. its connection to the relay) – keep waiting
  if (code === 'DESKTOP_GONE') return controlState ? renderControl('di-drop nicht erreichbar – warte …') : render('busy', { title: 'Warte auf di-drop …' })
  // Previous connection not cleaned up yet, or di-drop is reconnecting to the relay itself
  // (it may take longer than the phone) → keep trying for about two minutes
  if (code === 'ALREADY_PAIRED' && retries < 6) return
  if (code === 'NO_RECEIVER' && retries < 15) return
  // di-drop no longer waits for this QR code (e.g. training restarted) → new code needed
  ended = true
  try {
    sessionStorage.removeItem(CONTROL_STORAGE)
  } catch {
    // not important
  }
  render('error', { title: 'Fernbedienung getrennt', text: esc(code === 'NO_RECEIVER' || code === 'SESSION_EXPIRED'
    ? 'di-drop wartet nicht mehr auf dieses Telefon. Bitte in der Schulungssteuerung erneut „Telefon verbinden“ wählen und den QR-Code scannen.'
    : ERRORS[code] ?? message ?? code) })
}

function endControl() {
  ended = true
  try {
    sessionStorage.removeItem(CONTROL_STORAGE)
  } catch {
    // not important
  }
  render('ok', { title: 'Fernbedienung beendet', text: 'di-drop hat die Verbindung beendet. Du kannst diese Seite schließen.' })
}

// Keep the display on while used as remote control
let wakeLock = null
async function keepAwake() {
  if (wakeLock || !navigator.wakeLock || document.visibilityState !== 'visible') return
  try {
    wakeLock = await navigator.wakeLock.request('screen')
    wakeLock.addEventListener('release', () => (wakeLock = null))
  } catch {
    // not supported / not allowed – the page still works
  }
}
document.addEventListener('visibilitychange', () => controlMode && keepAwake())

// ── Image ────────────────────────────────────────────────────────────────────

const TRANSFER_ID = /^[A-Za-z0-9_-]{22}$/
const imageError = (code, message) => Object.assign(new Error(message), { code })

function startImage(offer) {
  const { transferId, name, mime, size, sha256, chunks } = offer
  const valid = TRANSFER_ID.test(transferId ?? '') && typeof name === 'string' && /^image\/(jpeg|png)$/.test(mime) &&
    Number.isInteger(size) && size > 0 && size <= MAX_IMAGE_BYTES &&
    Number.isInteger(chunks) && chunks === Math.ceil(size / CHUNK_BYTES) && typeof sha256 === 'string'
  if (!valid) throw imageError('IMAGE_INVALID', 'Ungültige Bildangaben')
  image = { transferId, name: name.replace(/[\\/]/g, '_').slice(0, 120), mime, size, sha256, chunks, parts: [], received: 0 }
  renderProgress()
}

function renderProgress() {
  const percent = Math.floor((image.received / image.size) * 100)
  render('busy', { title: 'Bild wird empfangen …', progress: percent, facts: `${formatSize(image.received)} von ${formatSize(image.size)}` })
}

async function receiveChunk(data) {
  if (!image) throw imageError('IMAGE_INVALID', 'Bilddaten ohne Ankündigung')
  const index = image.parts.length
  if (index >= image.chunks) throw imageError('IMAGE_INVALID', 'Zu viele Bildblöcke')
  const bytes = await channel.openChunk(image.transferId, index, data)
  image.parts.push(bytes)
  image.received += bytes.length
  if (image.parts.length < image.chunks) return renderProgress()

  const blob = new Blob(image.parts, { type: image.mime })
  if (blob.size !== image.size || (await sha256B64url(await blob.arrayBuffer())) !== image.sha256) {
    throw imageError('IMAGE_INVALID', 'Prüfsumme stimmt nicht')
  }
  const file = new File([blob], image.name, { type: image.mime })
  await sendSealed({ type: 'image-received', transferId: image.transferId })
  image = null
  showImage(file)
}

function showImage(file) {
  const url = URL.createObjectURL(file)
  const canShare = navigator.canShare?.({ files: [file] })
  render('ok', {
    title: '✓ Bild empfangen',
    imageUrl: url,
    text: canShare
      ? 'Tippe auf „In Fotos sichern“ und wähle dann <strong>„Bild sichern“</strong> bzw. deine Galerie-App.'
      : 'Bild <strong>lange gedrückt halten</strong> und „Zu Fotos hinzufügen“ bzw. „Bild speichern“ wählen – oder unten herunterladen.',
    facts: `${esc(file.name)} · ${formatSize(file.size)}`,
    button: canShare
      ? { label: 'In Fotos sichern', action: () => navigator.share({ files: [file] }).catch(() => {}) }
      : { label: 'Herunterladen', action: () => download(url, file.name) },
  })
}

function download(url, name) {
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
}

const formatSize = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

// ── Location ─────────────────────────────────────────────────────────────────

const GEO = { enableHighAccuracy: true, timeout: 30_000, maximumAge: 0 }

function geoError(error) {
  const code = { 1: 'PERMISSION_DENIED', 2: 'POSITION_UNAVAILABLE', 3: 'TIMEOUT' }[error.code] ?? 'POSITION_UNAVAILABLE'
  sendSealed({ type: 'error', code }).catch(() => {})
  const text = {
    PERMISSION_DENIED: 'Der Standortzugriff wurde verweigert. Bitte in den Browser-Einstellungen erlauben und erneut versuchen.',
    POSITION_UNAVAILABLE: 'Der Standort konnte nicht bestimmt werden. Bitte unter freiem Himmel erneut versuchen.',
    TIMEOUT: 'Die Standortbestimmung hat zu lange gedauert.',
  }[code]
  render('error', { title: 'Kein Standort', text, button: { label: 'Erneut versuchen', action: sendOnce } })
}

function askSingle() {
  render('ready', {
    title: 'Standort senden',
    text: 'di-drop möchte deinen aktuellen Standort einmalig erhalten.',
    button: { label: 'Meinen Standort senden', action: sendOnce },
  })
}

function sendOnce() {
  render('busy', { title: 'Standort wird bestimmt …' })
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const position = positionFromGeolocation(pos)
    lastAccuracy = position.accuracy
    await sendSealed(position)
    render('busy', { title: 'Wird übertragen …' })
  }, geoError, GEO)
}

function askStream() {
  render('ready', {
    title: 'Live-Standort',
    text: 'di-drop möchte deinen Standort fortlaufend erhalten, solange diese Seite geöffnet ist.',
    button: { label: 'Live-Übertragung starten', action: startStream },
  })
}

function startStream() {
  render('busy', { title: 'Standort wird bestimmt …' })
  sendSealed({ type: 'status', state: 'streaming' }).catch(() => {})
  watchId = navigator.geolocation.watchPosition(async (pos) => {
    const position = positionFromGeolocation(pos)
    lastAccuracy = position.accuracy
    await sendSealed(position)
    sentCount++
    render('ok', {
      title: '<span class="live">Live-Übertragung läuft</span>',
      text: 'Bitte diese Seite geöffnet und das Display an lassen.',
      facts: `${sentCount} Positionen gesendet${lastAccuracy != null ? ` · ± ${Math.round(lastAccuracy)} m` : ''}`,
      secondary: { label: 'Stoppen', action: stopStream },
    })
  }, geoError, GEO)
}

function stopWatch() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId)
  watchId = null
}

async function stopStream() {
  stopWatch()
  await sendSealed({ type: 'status', state: 'stopped' }).catch(() => {})
  render('ok', { title: 'Live-Übertragung beendet', secondary: { label: 'Wieder starten', action: startStream } })
}

connect()
