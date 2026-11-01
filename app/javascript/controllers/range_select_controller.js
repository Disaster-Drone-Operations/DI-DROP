import { Controller } from '@hotwired/stimulus'

// Selecting checkboxes like in the Finder / Explorer:
//   click            one item on/off
//   Shift+click      everything between the last clicked item and this one gets its state
//   drag across      every item touched gets the new state of the first one
// Items marked data-range-skip (e.g. already provided) are left out of ranges and drags – a single click still works.
// Afterwards one "change" event bubbles up, so the surrounding form can recount.
//
//   <div data-controller="range-select"
//        data-action="pointerdown->range-select#down pointerover->range-select#over change->range-select#changed">
//     <label data-range-item>… <input type="checkbox"> …</label>
export default class extends Controller {
  connect() {
    this.up = () => this.release()
    window.addEventListener('pointerup', this.up)
    window.addEventListener('pointercancel', this.up)
  }

  disconnect() {
    window.removeEventListener('pointerup', this.up)
    window.removeEventListener('pointercancel', this.up)
  }

  get items() {
    return [...this.element.querySelectorAll('[data-range-item]')]
  }

  boxOf(item) {
    return item?.querySelector('input[type="checkbox"]')
  }

  // Pointer pressed on an item: remember Shift (the click follows) and get ready for dragging
  down(event) {
    const item = event.target.closest('[data-range-item]')
    this.shift = event.shiftKey
    if (!item || event.button !== 0 || event.shiftKey) return
    this.drag = { start: item, state: !this.boxOf(item).checked, moved: false, last: item }
  }

  // Dragging over further items: they (and the first one) get the new state
  over(event) {
    if (!this.drag || !(event.buttons & 1)) return
    const item = event.target.closest('[data-range-item]')
    if (!item || item === this.drag.last) return
    this.drag.last = item
    const changed = []
    if (!this.drag.moved) changed.push(this.drag.start)
    this.drag.moved = true
    if (!item.hasAttribute('data-range-skip')) changed.push(item)
    for (const i of changed) this.boxOf(i).checked = this.drag.state
    this.anchor = item
    this.notify()
  }

  release() {
    if (this.drag?.moved) {
      // Released over a label → the browser would toggle it once more with the click that follows
      const swallow = (e) => {
        if (e.target.closest?.('[data-range-item]')) e.preventDefault()
      }
      window.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
    }
    this.drag = null
  }

  // A checkbox was toggled by the user (click or space): Shift → the whole range
  changed(event) {
    if (!event.isTrusted) return // our own "change" (notify)
    const item = event.target.closest('[data-range-item]')
    if (!item || !this.items.includes(item)) return
    if (this.shift && this.anchor && this.anchor !== item) {
      const items = this.items
      const [from, to] = [items.indexOf(this.anchor), items.indexOf(item)].sort((a, b) => a - b)
      const state = this.boxOf(item).checked
      for (const i of items.slice(from, to + 1)) {
        if (i !== item && !i.hasAttribute('data-range-skip')) this.boxOf(i).checked = state
      }
      this.notify()
    }
    this.shift = false
    this.anchor = item
  }

  notify() {
    this.element.dispatchEvent(new Event('change', { bubbles: true }))
  }
}
