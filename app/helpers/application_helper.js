// Alle exportierten Funktionen aus app/helpers/*.js stehen in jedem Template
// direkt zur Verfügung, z. B. <%= formatDate(mission.date) %>

import { parseLocal } from '/lib/time.js'

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export function escapeHtml(value) {
  return value == null ? '' : String(value).replace(/[&<>"']/g, (c) => ESCAPES[c])
}

export function classNames(...args) {
  return args
    .flatMap((a) => (a && typeof a === 'object' ? Object.entries(a).filter(([, on]) => on).map(([k]) => k) : [a]))
    .filter(Boolean)
    .join(' ')
}

export function pluralize(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`
}

// Für Navigationslinks: aktiv bei exaktem Treffer oder bei Unterseiten
export function isCurrent(currentPath, path, { exact = false } = {}) {
  return currentPath === path || (!exact && currentPath.startsWith(`${path}/`))
}

// ── Datum & Zeit ──────────────────────────────────────────────────────────

const asDate = (v) => (v instanceof Date ? v : parseLocal(v))

export function formatDate(value, { weekday = true } = {}) {
  const d = asDate(value)
  if (!d) return ''
  return d.toLocaleDateString('de-DE', {
    weekday: weekday ? 'short' : undefined, day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

export function formatTime(value) {
  const d = asDate(value)
  return d ? d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : ''
}

export function formatDateTime(value) {
  return `${formatDate(value, { weekday: false })}, ${formatTime(value)} Uhr`
}

export function isToday(value) {
  const d = asDate(value)
  return !!d && d.toDateString() === new Date().toDateString()
}

// ── Links & Buttons ───────────────────────────────────────────────────────

// Wie Rails' button_to: kleines Formular, das per PATCH/DELETE abschickt
//   <%- buttonTo('Löschen', `/missions/${id}`, { method: 'delete', confirm: 'Sicher?' }) %>
export function buttonTo(label, path, { method = 'post', confirm, confirmButton, params = {}, class: cls = 'button', icon: iconName } = {}) {
  const hidden = Object.entries({ _method: method, ...params })
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join('')
  const confirmAttrs = confirm
    ? ` data-confirm="${escapeHtml(confirm)}"${confirmButton ? ` data-confirm-button="${escapeHtml(confirmButton)}"` : ''}`
    : ''
  const content = iconName ? `${icon(iconName)}<span>${escapeHtml(label)}</span>` : escapeHtml(label)
  return `<form class="button-to" action="#${escapeHtml(path)}" method="post"${confirmAttrs}>${hidden}<button type="submit" class="${escapeHtml(cls)}">${content}</button></form>`
}

// ── Icons (Strichzeichnungen im Stil von Lucide, 24×24) ───────────────────

const ICONS = {
  drone: '<circle cx="5" cy="5" r="3"/><circle cx="19" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><path d="M7.5 7.5 10 10M16.5 7.5 14 10M7.5 16.5 10 14M16.5 16.5 14 14"/><rect x="10" y="10" width="4" height="4" rx="1"/>',
  missions: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4M12 16h4M8 11h.01M8 16h.01"/>',
  settings: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  sliders: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  pencil: '<path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  pin: '<path d="M20 10c0 5-8 12-8 12s-8-7-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
  reopen: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  initial: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  kontrolle: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  spezial: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
}

export function icon(name, { size = 16, class: cls = 'icon' } = {}) {
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`
}
