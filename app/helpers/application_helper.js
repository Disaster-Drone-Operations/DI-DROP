// All exported functions from app/helpers/*.js are available directly in every
// template, e.g. <%= formatDate(mission.date) %>

import { parseLocal } from '/lib/time.js'
import platform from '/lib/platform/index.js'

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

// For navigation links: active on an exact match or on subpages
export function isCurrent(currentPath, path, { exact = false } = {}) {
  return currentPath === path || (!exact && currentPath.startsWith(`${path}/`))
}

// ── Date & time ───────────────────────────────────────────────────────────

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

// "13:57–14:03 Uhr" – with date if not from today
export function timeRange(from, to) {
  const a = asDate(from)
  const b = asDate(to)
  if (!a) return ''
  const range = b && formatTime(b) !== formatTime(a) ? `${formatTime(a)}–${formatTime(b)}` : formatTime(a)
  return isToday(a) ? `${range} Uhr` : `${formatDate(a, { weekday: false })}, ${range} Uhr`
}

// Display keyboard shortcuts matching the OS: "⌘N" (Mac) or "Strg+N" (Windows)
// Order as in the OS: macOS ⌃⌥⇧⌘, Windows Strg+Alt+Umschalt+
export function shortcut(keys) {
  const mac = /Mac/.test(navigator.userAgent)
  const parts = keys.split('+')
  const key = parts.pop() || '+'
  const has = (m) => parts.includes(m)
  if (mac) return `${has('Ctrl') ? '⌃' : ''}${has('Alt') ? '⌥' : ''}${has('Shift') ? '⇧' : ''}${has('Mod') ? '⌘' : ''}${key}`
  return [has('Mod') || has('Ctrl') ? 'Strg' : null, has('Alt') ? 'Alt' : null, has('Shift') ? 'Umschalt' : null, key].filter(Boolean).join('+')
}

// macOS desktop: app menu with settings, uploads … (Windows/browser: everything in the sidebar)
export const hasNativeMenu = () => platform.name === 'tauri' && platform.os === 'macos'

// ── Links & Buttons ───────────────────────────────────────────────────────

// Like Rails' button_to: small form that submits via PATCH/DELETE
//   <%- buttonTo('Löschen', `/missions/${id}`, { method: 'delete', confirm: 'Sicher?' }) %>
export function buttonTo(label, path, { method = 'post', confirm, confirmButton, params = {}, class: cls = 'button', icon: iconName, title } = {}) {
  const hidden = Object.entries({ _method: method, ...params })
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join('')
  const confirmAttrs = confirm
    ? ` data-confirm="${escapeHtml(confirm)}"${confirmButton ? ` data-confirm-button="${escapeHtml(confirmButton)}"` : ''}`
    : ''
  const content = iconName ? `${icon(iconName)}<span>${escapeHtml(label)}</span>` : escapeHtml(label)
  return `<form class="button-to" action="#${escapeHtml(path)}" method="post"${confirmAttrs}>${hidden}<button type="submit" class="${escapeHtml(cls)}"${title ? ` title="${escapeHtml(title)}"` : ''}>${content}</button></form>`
}

// ── Icons (line drawings in Lucide style, 24×24) ──────────────────────────

const ICONS = {
  battery: '<rect x="2" y="7" width="16" height="10" rx="2"/><path d="M22 11v2"/><path d="M6 10v4M10 10v4"/>',
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
  control: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  images: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
  import: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  video: '<path d="m16 13 5.22 3.48a.5.5 0 0 0 .78-.42V7.87a.5.5 0 0 0-.75-.43L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  radar: '<path d="M19.07 4.93A10 10 0 0 0 6.99 3.34"/><path d="M4 6h.01"/><path d="M2.29 9.62A10 10 0 1 0 21.31 8.35"/><path d="M16.24 7.76A6 6 0 1 0 8.23 16.67"/><path d="M12 18h.01"/><path d="M17.99 11.66A6 6 0 0 1 15.77 16.67"/><circle cx="12" cy="12" r="2"/><path d="m13.41 10.59 5.66-5.66"/>',
  protocol: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8M16 13H8M16 17H8"/>',
  upload: '<path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  play: '<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5Z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  toTop: '<path d="M5 3h14"/><path d="m18 13-6-6-6 6"/><path d="M12 7v14"/>',
  toBottom: '<path d="M19 21H5"/><path d="m6 11 6 6 6-6"/><path d="M12 17V3"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  copy: '<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  map: '<path d="M14.1 5.9 9.9 3.1a2 2 0 0 0-1.8-.1L3.6 5A1 1 0 0 0 3 6v14a1 1 0 0 0 1.4.9l4.5-2a2 2 0 0 1 1.8.1l4.2 2.8a2 2 0 0 0 1.8.1l4.7-2A1 1 0 0 0 21 18V4a1 1 0 0 0-1.4-.9l-4.5 2a2 2 0 0 1-1.8-.1Z"/><path d="M15 5.8v15M9 3.2v15"/>',
  phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
  special: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
}

export function icon(name, { size = 16, class: cls = 'icon' } = {}) {
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`
}
