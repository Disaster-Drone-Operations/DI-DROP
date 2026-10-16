// Contract tests for the Location Relay Protocol v1 (docs/location-relay-protocol.md).
// They run against any compatible relay:
//   RELAY_URL=http://127.0.0.1:8787 node --test test/relay.contract.test.mjs
// (locally: node relay/dev.mjs && npx wrangler dev --config relay/wrangler.dev.toml)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createSecrets, createChannel, sessionSocketUrl, randomB64url, positionFromGeolocation, sha256B64url, CHUNK_BYTES,
} from '../relay/protocol.js'

const RELAY = process.env.RELAY_URL ?? 'http://127.0.0.1:8787'

// Small test client: queues messages, waits for specific types
function connect(sessionId) {
  const ws = new WebSocket(sessionSocketUrl(RELAY, sessionId))
  ws.binaryType = 'arraybuffer'
  const queue = []
  const waiters = []
  ws.onmessage = (e) => {
    // Binary frames as { type: 'binary', data } so next() can wait for them like for messages
    const msg = typeof e.data === 'string' ? JSON.parse(e.data) : { type: 'binary', data: e.data }
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

// Test "image" with pseudo-random content
function fakeImage(size) {
  const bytes = new Uint8Array(size)
  for (let i = 0; i < size; i++) bytes[i] = (i * 7919 + 13) & 0xff
  return bytes
}

// Desktop sends an image: sealed image-offer + one binary frame per block
async function sendImage({ desktop, channel }, bytes, { transferId = randomB64url(16), tamper = null } = {}) {
  const chunks = Math.ceil(bytes.length / CHUNK_BYTES)
  desktop.raw(await channel.seal({
    type: 'image-offer', transferId, name: 'test.jpg', mime: 'image/jpeg', size: bytes.length,
    sha256: await sha256B64url(bytes), chunks,
  }))
  const frames = []
  for (let i = 0; i < chunks; i++) frames.push(await channel.sealChunk(transferId, i, bytes.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES)))
  for (const frame of tamper ? tamper(frames) : frames) desktop.ws.send(frame)
  return { transferId, chunks }
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

// ── Images (desktop → phone) ─────────────────────────────────────────────────

test('image: blocks arrive in order and the phone reassembles the exact bytes', async () => {
  const session = await desktopReady()
  const { phone, phoneChannel } = await pairPhone(session)
  const bytes = fakeImage(2 * CHUNK_BYTES + 1234) // 3 blocks
  await sendImage(session, bytes)

  const offer = await phoneChannel.open(await phone.next(ofType('data')))
  assert.equal(offer.type, 'image-offer')
  assert.equal(offer.chunks, 3)
  const parts = []
  for (let i = 0; i < offer.chunks; i++) {
    const { data } = await phone.next(ofType('binary'))
    parts.push(await phoneChannel.openChunk(offer.transferId, i, data))
  }
  const received = new Uint8Array(await new Blob(parts).arrayBuffer())
  assert.equal(received.length, bytes.length)
  assert.equal(await sha256B64url(received), offer.sha256)

  phone.raw(await phoneChannel.seal({ type: 'image-received', transferId: offer.transferId }))
  const receipt = await session.channel.open(await session.desktop.next(ofType('data')))
  assert.deepEqual([receipt.type, receipt.transferId], ['image-received', offer.transferId])
  session.desktop.send({ type: 'close' })
})

test('image: swapped, foreign or modified blocks are not decrypted', async () => {
  const session = await desktopReady()
  const { phone, phoneChannel } = await pairPhone(session)
  const bytes = fakeImage(CHUNK_BYTES + 10) // 2 blocks
  // swapped order
  await sendImage(session, bytes, { tamper: (frames) => [frames[1], frames[0]] })
  const offer = await phoneChannel.open(await phone.next(ofType('data')))
  const first = (await phone.next(ofType('binary'))).data
  await assert.rejects(phoneChannel.openChunk(offer.transferId, 0, first), (e) => e.code === 'DECRYPT_FAILED')
  const second = (await phone.next(ofType('binary'))).data
  // foreign transfer id
  await assert.rejects(phoneChannel.openChunk(randomB64url(16), 0, second), (e) => e.code === 'DECRYPT_FAILED')
  // modified byte
  const modified = new Uint8Array(second.slice(0))
  modified[40] ^= 1
  await assert.rejects(phoneChannel.openChunk(offer.transferId, 0, modified), (e) => e.code === 'DECRYPT_FAILED')
  session.desktop.send({ type: 'close' })
})

test('image: binary frames from the phone are rejected', async () => {
  const session = await desktopReady()
  const { phone } = await pairPhone(session)
  phone.ws.send(new Uint8Array([1, 2, 3]))
  assert.equal((await phone.next(ofType('error'))).code, 'INVALID_MESSAGE')
  await phone.closed
  session.desktop.send({ type: 'close' })
})

test('image: binary frames before the desktop hello are rejected', async () => {
  const { sessionId } = createSecrets()
  const stranger = connect(sessionId)
  await stranger.opened
  stranger.ws.send(new Uint8Array(100))
  assert.equal((await stranger.next(ofType('error'))).code, 'INVALID_MESSAGE')
  await stranger.closed
})

test('image: oversized binary frames close the session', async () => {
  const session = await desktopReady()
  const { phone } = await pairPhone(session)
  session.desktop.ws.send(new Uint8Array(400 * 1024))
  assert.equal((await session.desktop.next(ofType('error'))).code, 'INVALID_MESSAGE')
  await session.desktop.closed
  assert.equal((await phone.next(ofType('error'))).code, 'DESKTOP_GONE') // nothing reached the phone
  phone.close()
})

test('image: without a paired phone the relay reports NO_RECEIVER and keeps nothing', async () => {
  const session = await desktopReady()
  session.desktop.ws.send(new Uint8Array(1000))
  assert.equal((await session.desktop.next(ofType('error'))).code, 'NO_RECEIVER')
  session.desktop.send({ type: 'close' })
})

test('health announces the image feature', async () => {
  const health = await (await fetch(`${RELAY}/health`)).json()
  assert.ok(health.features?.includes('image'))
})
