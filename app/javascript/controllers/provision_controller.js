import { Controller } from '@hotwired/stimulus'
import { render } from '/lib/views.js'
import { morph } from '/lib/morph.js'
import { load, summarize } from '/app/services/provision_status.js'

// Shows on every page what has already been provided – live during uploads.
//   <span data-provision-assignment="12"></span>        status of an assignment
//   <span data-provision-files="5" data-compact data-label="W"></span>  status of a file (icon)
//   data-wide: text + long bar (header of the assignment page)
//   <div data-provision-complete="12" data-provision-title="…">  „Erledigt“: asks for confirmation
//        as long as nothing has been provided; highlighted afterwards
export default class extends Controller {
  connect() {
    this.onChange = () => this.schedule()
    window.addEventListener('uploads:changed', this.onChange)
    this.update()
  }

  disconnect() {
    window.removeEventListener('uploads:changed', this.onChange)
    clearTimeout(this.timer)
  }

  // Check at most about once per second
  schedule() {
    this.timer ??= setTimeout(() => {
      this.timer = null
      this.update()
    }, 800)
  }

  async update() {
    const assignmentSlots = [...this.element.querySelectorAll('[data-provision-assignment]')]
    const completeSlots = [...this.element.querySelectorAll('[data-provision-complete]')]
    const fileSlots = [...this.element.querySelectorAll('[data-provision-files]')]
    if (!assignmentSlots.length && !completeSlots.length && !fileSlots.length) return

    const assignmentIds = [...new Set([...assignmentSlots.map((e) => e.dataset.provisionAssignment), ...completeSlots.map((e) => e.dataset.provisionComplete)].map(Number))]
    const fileIdsOf = (el) => el.dataset.provisionFiles.split(',').filter(Boolean).map(Number)
    const rows = await load({ assignmentIds, fileIds: [...new Set(fileSlots.flatMap(fileIdsOf))] })
    const forAssignment = (id) => summarize(rows.filter((r) => r.assignment_id === id))

    const options = (el) => ({ compact: 'compact' in el.dataset, wide: 'wide' in el.dataset, label: el.dataset.label ?? null })
    for (const el of assignmentSlots) {
      morph(el, render('provisions/_status', { s: forAssignment(Number(el.dataset.provisionAssignment)), ...options(el) }))
    }
    for (const el of fileSlots) {
      const ids = new Set(fileIdsOf(el))
      morph(el, render('provisions/_status', { s: summarize(rows.filter((r) => ids.has(r.media_file_id))), ...options(el) }))
    }
    for (const el of completeSlots) this.markComplete(el, forAssignment(Number(el.dataset.provisionComplete)))
  }

  // „Erledigt“ button: highlight as soon as something has been provided – otherwise ask first
  markComplete(el, status) {
    const provided = status.done > 0
    const message = `Für „${el.dataset.provisionTitle}“ wurde noch nichts bereitgestellt (Nextcloud oder USB-Stick). Trotzdem als erledigt markieren?`
    const form = el.querySelector('form.button-to')
    const button = el.querySelector('button')
    button?.classList.toggle('button--primary', provided)
    if (form) {
      if (provided) {
        delete form.dataset.confirm
        delete form.dataset.confirmButton
      } else {
        form.dataset.confirm = message
        form.dataset.confirmButton = 'Trotzdem erledigt'
      }
    } else if (button) {
      if (provided) delete button.dataset.dialogConfirmParam
      else button.dataset.dialogConfirmParam = message
    }
  }
}
