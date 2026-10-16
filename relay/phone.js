// Phone page: pairing via QR fragment, then either determine and send the location
// or (mode "image") receive an image from di-drop and save it to the photos.
// The texts shown on the page are German (UI).
import {
  parsePairingFragment, sessionSocketUrl, createChannel, positionFromGeolocation, send, sha256B64url, VERSION,
  CHUNK_BYTES, MAX_IMAGE_BYTES,
} from '/protocol.js'

const view = document.getElementById('view')
const pairing = parsePairingFragment(location.hash)
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
  DECRYPT_FAILED: 'Das Bild kam beschädigt an. Bitte in di-drop erneut senden.',
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
  if (!imageMode && !navigator.geolocation) {
    return render('error', { title: 'Kein Standort verfügbar', text: 'Dieser Browser unterstützt keine Standortbestimmung.' })
  }
  render('busy', { title: 'Verbinde mit di-drop …' })
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
    // After "Fertig"/"✓ übertragen" (done/sent) closing the connection is not an error
    if (!view.classList.contains('state-error') && !view.classList.contains('state-ok')) render('error', { title: 'Verbindung beendet', text: 'Zum erneuten Senden den QR-Code in di-drop neu scannen.' })
    stopWatch()
  }
}

async function handle(msg) {
  if (msg.v !== VERSION) return
  if (msg.type === 'paired') return render('busy', { title: 'Verbunden', text: imageMode ? 'Warte auf das Bild …' : 'Warte auf di-drop …' })
  if (msg.type === 'error') return fail(msg.code, msg.message)
  if (msg.type === 'close') return view.classList.contains('state-ok') ? undefined : render('ok', { title: 'Fertig', text: 'di-drop hat die Übertragung beendet. Du kannst diese Seite schließen.' })
  if (msg.type !== 'data') return

  const payload = await channel.open(msg)
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
