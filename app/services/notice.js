// Notice at the top right without changing the page (same look as the flash after redirects),
// e.g. for events in the background: showNotice('SD-Karte erkannt …')
import { icon, escapeHtml } from '/app/helpers/index.js'

export function showNotice(text, { alert = false, delay = 6000 } = {}) {
  const host = document.querySelector('main.content')
  if (!host) return
  host.querySelector('.toast')?.remove()
  host.querySelector('.titlebar')?.insertAdjacentHTML('afterend',
    `<div class="toast ${alert ? 'toast--alert' : ''}" data-controller="flash" data-flash-delay-value="${delay}" role="status">` +
    `${icon(alert ? 'alert' : 'check')}<span>${escapeHtml(text)}</span></div>`)
}
