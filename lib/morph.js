// Minimal DOM diffing: takes over new HTML but only changes what really changed.
// This keeps buttons, focus and selections intact when a view is redrawn often
// (e.g. on every live position). Similar to Turbo's "morph", just without keys/IDs.
//   morph(element, render('location/_panel', locals))

export function morph(element, html) {
  const template = document.createElement('template')
  template.innerHTML = html
  patchChildren(element, template.content)
}

function patchChildren(target, source) {
  const next = [...source.childNodes]
  next.forEach((node, i) => {
    const current = target.childNodes[i]
    if (!current) target.appendChild(node)
    else if (!sameKind(current, node)) target.replaceChild(node, current)
    else patch(current, node)
  })
  while (target.childNodes.length > next.length) target.lastChild.remove()
}

const sameKind = (a, b) => a.nodeType === b.nodeType && a.nodeName === b.nodeName

function patch(current, next) {
  if (current.nodeType !== Node.ELEMENT_NODE) {
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue
    return
  }
  // <details open>: expanded/collapsed is up to the user – only preset on the first render
  const keep = (name) => name === 'open' && current.tagName === 'DETAILS'
  for (const { name } of [...current.attributes]) if (!next.hasAttribute(name) && !keep(name)) current.removeAttribute(name)
  for (const { name, value } of [...next.attributes]) if (current.getAttribute(name) !== value && !keep(name)) current.setAttribute(name, value)
  if (current.tagName === 'INPUT' || current.tagName === 'TEXTAREA') return // don't touch the user's input
  patchChildren(current, next)
}
