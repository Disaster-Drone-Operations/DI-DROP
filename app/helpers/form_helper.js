// Formular-Builder, angelehnt an Rails' form_with / simple_form:
//
//   <% const f = formFor(mission, 'mission') %>
//   <%- f.field('title', { label: 'Stichwort', autofocus: true }) %>
//   <%- f.field('kind', { type: 'segmented', options: [['einsatz', 'Einsatz'], ['uebung', 'Übung']] }) %>

import { escapeHtml, icon } from '/app/helpers/application_helper.js'
import platform from '/lib/platform/index.js'

const attr = (name, value) => (value == null || value === false ? '' : value === true ? ` ${name}` : ` ${name}="${escapeHtml(value)}"`)

function control({ type = 'text', id, name, value, options = [], placeholder, required, autofocus, rows = 3, min, max, step, list }) {
  const common = `${attr('id', id)}${attr('name', name)}${attr('required', required)}${attr('autofocus', autofocus)}`

  switch (type) {
    case 'textarea':
      return `<textarea${common}${attr('rows', rows)}${attr('placeholder', placeholder)}>${escapeHtml(value)}</textarea>`

    case 'select':
      return `<select${common}>${options
        .map(([v, label]) => `<option value="${escapeHtml(v)}"${String(v) === String(value ?? '') ? ' selected' : ''}>${escapeHtml(label)}</option>`)
        .join('')}</select>`

    // Native-artige Umschalter (macOS "Segmented Control")
    case 'segmented':
      return `<div class="segmented" role="radiogroup">${options
        .map(([v, label], i) => {
          const optionId = `${id}_${i}`
          const checked = String(v) === String(value ?? '') ? ' checked' : ''
          return `<input type="radio" id="${optionId}" name="${escapeHtml(name)}" value="${escapeHtml(v)}"${checked}><label for="${optionId}">${escapeHtml(label)}</label>`
        })
        .join('')}</div>`

    case 'folder':
      if (!platform.capabilities.folders) {
        return `<div class="input-with-button"><input type="text"${common}${attr('value', value)}${attr('placeholder', 'Ordnerpfad')}></div>
                <p class="hint">Im Browser ist keine Ordnerauswahl möglich – Pfad bitte von Hand eintragen.</p>`
      }
      return `<div class="input-with-button" data-controller="folder-picker">
          <input type="text"${common}${attr('value', value)} data-folder-picker-target="input" placeholder="Kein Ordner gewählt">
          <button type="button" class="button" data-action="folder-picker#pick">${icon('folder')}<span>Auswählen …</span></button>
        </div>`

    default:
      return `<input type="${escapeHtml(type)}"${common}${attr('value', value)}${attr('placeholder', placeholder)}${attr('min', min)}${attr('max', max)}${attr('step', step)}${attr('list', list)}>`
  }
}

// Ein komplettes Feld: Label, Eingabe, Fehler, Hinweis
//   button: HTML eines Knopfs rechts neben der Eingabe (z. B. „Hier“ beim Einsatzort)
export function field({ label, hint, errors = [], wide, button, ...opts }) {
  const invalid = errors.length > 0
  const input = button ? `<div class="input-with-button">${control(opts)}${button}</div>` : control(opts)
  return `<div class="field${invalid ? ' field--invalid' : ''}${wide ? ' field--wide' : ''}">
    ${label ? `<label class="field__label" for="${escapeHtml(opts.id)}">${escapeHtml(label)}${opts.required ? ' <span class="required">*</span>' : ''}</label>` : ''}
    ${input}
    ${invalid ? `<p class="field__error">${escapeHtml(label ?? '')} ${escapeHtml(errors.join(', '))}</p>` : ''}
    ${hint ? `<p class="hint">${escapeHtml(hint)}</p>` : ''}
  </div>`
}

export function formFor(record, model) {
  return {
    field(name, opts = {}) {
      return field({
        id: `${model}_${name}`,
        name: `${model}[${name}]`,
        value: record[name],
        errors: record.errors?.[name] ?? [],
        ...opts,
      })
    },
  }
}

export function errorSummary(record) {
  const count = Object.keys(record.errors ?? {}).length
  if (!count) return ''
  return `<div class="callout callout--danger" role="alert">${icon('alert')}<span>Bitte prüfe die markierten Felder.</span></div>`
}

export function isDesktop() {
  return platform.name === 'tauri'
}
