// Keyboard helpers shared by several pages.

// Space as "switch visible ↔ thermal image" (gallery, image overview, comparison images).
// Not while typing, not with a dialog open (the gallery checks itself) and not on a selected image in the
// overview – there space opens it large (app/javascript/shortcuts.js).
export function isVariantSpace(event, { inDialog = false } = {}) {
  if (event.key !== ' ' || event.metaKey || event.ctrlKey || event.altKey) return false
  if (!inDialog && document.querySelector('dialog[open]')) return false
  const target = event.target
  if (target?.closest?.('input:not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable]')) return false
  if (target?.closest?.('.shot__image')) return false
  return true
}
