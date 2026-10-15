// Phone page: pairing via QR fragment, determine location, send encrypted.
// The texts shown on the page are German (UI).
import {
  parsePairingFragment, sessionSocketUrl, createChannel, positionFromGeolocation, send, VERSION,
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

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function render(state, { title, text = '', button = null, secondary = null, facts = '' } = {}) {
  view.className = `state-${state}`
  view.innerHTML = `
    ${state === 'busy' ? '<div class="spinner"></div>' : ''}
    <h1>${title}</h1>
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
  if (!navigator.geolocation) {
    return render('error', { title: 'Kein Standort verfügbar', text: 'Dieser Browser unterstützt keine Standortbestimmung.' })
  }
  render('busy', { title: 'Verbinde mit di-drop …' })
  channel = await createChannel({ ...pairing, role: 'phone' })
  ws = new WebSocket(sessionSocketUrl(location.origin, pairing.sessionId))

  ws.onopen = async () => {
    send(ws, { type: 'hello', role: 'phone' })
    // Pairing proof: only someone who knows the secret from the QR code can create it
    ws.send(JSON.stringify(await channel.seal({ type: 'pair', ts: Date.now() })))
  }
  ws.onmessage = (event) => handle(JSON.parse(event.data)).catch((e) => fail('INVALID_MESSAGE', e.message))
  ws.onclose = () => {
    // After "Fertig"/"✓ übertragen" (done/sent) closing the connection is not an error
    if (!view.classList.contains('state-error') && !view.classList.contains('state-ok')) render('error', { title: 'Verbindung beendet', text: 'Zum erneuten Senden den QR-Code in di-drop neu scannen.' })
    stopWatch()
  }
}

async function handle(msg) {
  if (msg.v !== VERSION) return
  if (msg.type === 'paired') return render('busy', { title: 'Verbunden', text: 'Warte auf di-drop …' })
  if (msg.type === 'error') return fail(msg.code, msg.message)
  if (msg.type === 'close') return view.classList.contains('state-ok') ? undefined : render('ok', { title: 'Fertig', text: 'di-drop hat die Übertragung beendet. Du kannst diese Seite schließen.' })
  if (msg.type !== 'data') return

  const payload = await channel.open(msg)
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
