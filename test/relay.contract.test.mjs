// Contract tests for the Location Relay Protocol v1 (docs/location-relay-protocol.md).
// They run against any compatible relay:
//   RELAY_URL=http://127.0.0.1:8787 node --test test/relay.contract.test.mjs
// (locally: node relay/dev.mjs && npx wrangler dev --config relay/wrangler.dev.toml)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSecrets, createChannel, sessionSocketUrl, randomB64url, positionFromGeolocation } from '../relay/protocol.js'

const RELAY = process.env.RELAY_URL ?? 'http://127.0.0.1:8787'

// Small test client: queues messages, waits for specific types
function connect(sessionId) {
  const ws = new WebSocket(sessionSocketUrl(RELAY, sessionId))
  const queue = []
  const waiters = []
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    const i = waiters.findIndex((w) => w.match(msg))
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg)
    else queue.push(msg)
  }
  const closed = new Promise((resolve) => (ws.onclose = (e) => resolve(e.code)))
  const opened = new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  return {
    ws, closed, opened,
    send: (m) => ws.send(JSON.stringify({ v: 1, ...m })),
    raw: (m) => ws.send(JSON.stringify(m)),
    next(match = () => true, ms = 3000) {
      const i = queue.findIndex(match)
      if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0])
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout waiting for message')), ms)
        waiters.push({ match, resolve: (m) => { clearTimeout(timer); resolve(m) } })
      })
    },
    close: () => ws.close(),
  }
}
const ofType = (type) => (m) => m.type === type

async function desktopReady(secrets = createSecrets()) {
  const desktop = connect(secrets.sessionId)
  await desktop.opened
  desktop.send({ type: 'hello', role: 'desktop', token: secrets.desktopToken })
  await desktop.next(ofType('desktop-ready'))
  return { desktop, secrets, channel: await createChannel({ ...secrets, role: 'desktop' }) }
}

// Phone connects and pairs; desktop verifies and accepts
async function pairPhone({ desktop, secrets, channel }, phoneSecret = secrets.phoneSecret) {
  const phone = connect(secrets.sessionId)
  await phone.opened
  const phoneChannel = await createChannel({ sessionId: secrets.sessionId, phoneSecret, role: 'phone' })
  phone.send({ type: 'hello', role: 'phone' })
  const { phoneId } = await desktop.next(ofType('phone-connected'))
  phone.raw(await phoneChannel.seal({ type: 'pair', ts: Date.now() }))
  const probe = await desktop.next(ofType('data'))
  try {
    const payload = await channel.open(probe)
    assert.equal(payload.type, 'pair')
    desktop.send({ type: 'accept', phoneId })
    await phone.next(ofType('paired'))
    return { phone, phoneChannel, phoneId, accepted: true }
  } catch {
    desktop.send({ type: 'reject', phoneId })
    return { phone, phoneChannel, phoneId, accepted: false }
  }
}

const fakeFix = (lat = 50.977500, lon = 11.023600) => positionFromGeolocation({
  timestamp: Date.now(),
  coords: { latitude: lat, longitude: lon, altitude: 427.3, accuracy: 4.8, altitudeAccuracy: 7.1, heading: null, speed: null },
})

test('single position: desktop receives decrypted position, phone receives ACK', async () => {
  const session = await desktopReady()
  const { phone, phoneChannel } = await pairPhone(session)

  session.desktop.raw(await session.channel.seal({ type: 'request', mode: 'single' }))
  const request = await phoneChannel.open(await phone.next(ofType('data')))
  assert.deepEqual([request.type, request.mode], ['request', 'single'])

  phone.raw(await phoneChannel.seal(fakeFix()))
  const position = await session.channel.open(await session.desktop.next(ofType('data')))
  assert.equal(position.type, 'position')
  assert.equal(position.lat, 50.977500)
  assert.equal(position.accuracy, 4.8)

  session.desktop.raw(await session.channel.seal({ type: 'ack', ackSeq: position.seq }))
  const ack = await phoneChannel.open(await phone.next(ofType('data')))
  assert.equal(ack.type, 'ack')
  session.desktop.send({ type: 'close' })
  await Promise.all([session.desktop.closed, phone.closed])
})

test('live stream: multiple positions arrive in order', async () => {
  const session = await desktopReady()
  const { phone, phoneChannel } = await pairPhone(session)
  for (let i = 0; i < 5; i++) phone.raw(await phoneChannel.seal(fakeFix(50 + i / 1000, 11)))
  const seqs = []
  for (let i = 0; i < 5; i++) seqs.push((await session.channel.open(await session.desktop.next(ofType('data')))).seq)
  assert.deepEqual(seqs, [2, 3, 4, 5, 6]) // seq 1 was the pairing proof
  session.desktop.send({ type: 'close' })
})

test('role takeover: a bare session id is not enough for the desktop role', async () => {
  const session = await desktopReady()
  const attacker = connect(session.secrets.sessionId)
  await attacker.opened
  attacker.send({ type: 'hello', role: 'desktop', token: randomB64url(32) })
  const error = await attacker.next(ofType('error'))
  assert.equal(error.code, 'UNAUTHORIZED')
  await attacker.closed
  // legitimate desktop is still connected and works
  const { accepted } = await pairPhone(session)
  assert.equal(accepted, true)
  session.desktop.send({ type: 'close' })
})

test('desktop reconnect with its own token takes over the session including the paired phone', async () => {
  const session = await desktopReady()
  await pairPhone(session)
  session.desktop.close()
  await session.desktop.closed
  const again = connect(session.secrets.sessionId)
  await again.opened
  again.send({ type: 'hello', role: 'desktop', token: session.secrets.desktopToken })
  await again.next(ofType('desktop-ready'))
  const info = await again.next(ofType('phone-connected'))
  assert.equal(info.paired, true)
  again.send({ type: 'close' })
})

test('without a desktop nothing is accepted or buffered (NO_RECEIVER)', async () => {
  const { sessionId } = createSecrets()
  const phone = connect(sessionId)
  await phone.opened
  phone.send({ type: 'hello', role: 'phone' })
  assert.equal((await phone.next(ofType('error'))).code, 'NO_RECEIVER')
  await phone.closed
})

test('wrong key: pairing is rejected', async () => {
  const session = await desktopReady()
  const { phone, accepted } = await pairPhone(session, randomB64url(32))
  assert.equal(accepted, false)
  assert.equal((await phone.next(ofType('error'))).code, 'UNAUTHORIZED')
  await phone.closed
  session.desktop.send({ type: 'close' })
})

test('replay: the same encrypted message is accepted only once', async () => {
  const session = await desktopReady()
  const { phone, phoneChannel } = await pairPhone(session)
  const sealed = await phoneChannel.seal(fakeFix())
  phone.raw(sealed)
  phone.raw(sealed)
  await session.channel.open(await session.desktop.next(ofType('data')))
  await assert.rejects(session.channel.open(await session.desktop.next(ofType('data'))), (e) => e.code === 'REPLAY')
  session.desktop.send({ type: 'close' })
})

test('tampering: modified ciphertext is detected', async () => {
  const session = await desktopReady()
  const { phone, phoneChannel } = await pairPhone(session)
  const sealed = await phoneChannel.seal(fakeFix())
  const ct = sealed.ct.split('')
  ct[5] = ct[5] === 'A' ? 'B' : 'A'
  phone.raw({ ...sealed, ct: ct.join('') })
  await assert.rejects(session.channel.open(await session.desktop.next(ofType('data'))), (e) => e.code === 'DECRYPT_FAILED')
  session.desktop.send({ type: 'close' })
})

test('second phone is rejected (ALREADY_PAIRED)', async () => {
  const session = await desktopReady()
  await pairPhone(session)
  const second = connect(session.secrets.sessionId)
  await second.opened
  second.send({ type: 'hello', role: 'phone' })
  assert.equal((await second.next(ofType('error'))).code, 'ALREADY_PAIRED')
  session.desktop.send({ type: 'close' })
})

test('isolation: data from session A does not reach desktop B', async () => {
  const a = await desktopReady()
  const b = await desktopReady()
  const { phone, phoneChannel } = await pairPhone(a)
  phone.raw(await phoneChannel.seal(fakeFix()))
  await a.channel.open(await a.desktop.next(ofType('data')))
  await assert.rejects(b.desktop.next(ofType('data'), 800), /Timeout/)
  a.desktop.send({ type: 'close' })
  b.desktop.send({ type: 'close' })
})

test('unpaired phone may only send the pairing proof', async () => {
  const session = await desktopReady()
  const phone = connect(session.secrets.sessionId)
  await phone.opened
  const phoneChannel = await createChannel({ ...session.secrets, role: 'phone' })
  phone.send({ type: 'hello', role: 'phone' })
  await session.desktop.next(ofType('phone-connected'))
  phone.raw(await phoneChannel.seal({ type: 'pair', ts: Date.now() }))
  phone.raw(await phoneChannel.seal(fakeFix())) // before confirmation → not allowed
  assert.equal((await phone.next(ofType('error'))).code, 'INVALID_MESSAGE')
  session.desktop.send({ type: 'close' })
})

test('health returns the protocol version without sensitive data', async () => {
  const health = await (await fetch(`${RELAY}/health`)).json()
  assert.equal(health.ok, true)
  assert.equal(health.protocol, 1)
})
