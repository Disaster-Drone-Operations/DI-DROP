// The app's clock. Normally the real time; in training mode a simulated clock that starts on
// the day of the exercise and can run faster or jump ahead (app/services/training.js).
//
// Every *domain* "now" (missions, assignments, due times, countdowns, created_at …) must use
// now()/nowMs() from here – never Date.now() / new Date(). Technical times (timeouts, retries,
// transfer speed, relay) stay on the real clock.

let sim = null // { anchorSim, anchorReal, speed, running }

export const isSimulated = () => !!sim

export function nowMs() {
  if (!sim) return Date.now()
  return sim.anchorSim + (sim.running ? (Date.now() - sim.anchorReal) * sim.speed : 0)
}

export const now = () => new Date(nowMs())

// { at: ms, speed, running } – what has to be saved to continue later
export const snapshot = () => (sim ? { at: Math.round(nowMs()), speed: sim.speed, running: sim.running } : null)

// Switch to the simulated clock / change it (all fields optional, re-anchored at the current moment)
export function setClock({ at = nowMs(), speed = sim?.speed ?? 1, running = sim?.running ?? false } = {}) {
  sim = { anchorSim: at, anchorReal: Date.now(), speed, running }
  window.dispatchEvent(new CustomEvent('clock:changed', { detail: snapshot() }))
}
