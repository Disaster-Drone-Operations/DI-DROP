// Minimaler DOM-Abgleich: übernimmt neues HTML, ändert aber nur, was sich wirklich geändert hat.
// So bleiben Knöpfe, Fokus und Markierungen erhalten, wenn eine Ansicht oft neu gezeichnet wird
// (z. B. bei jeder Live-Position). Ähnlich wie Turbos "morph", nur ohne Schlüssel/IDs.
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
  // <details open>: auf-/zugeklappt hat der Nutzer – nur beim ersten Zeichnen vorgeben
  const keep = (name) => name === 'open' && current.tagName === 'DETAILS'
  for (const { name } of [...current.attributes]) if (!next.hasAttribute(name) && !keep(name)) current.removeAttribute(name)
  for (const { name, value } of [...next.attributes]) if (current.getAttribute(name) !== value && !keep(name)) current.setAttribute(name, value)
  if (current.tagName === 'INPUT' || current.tagName === 'TEXTAREA') return // Eingaben des Nutzers nicht anfassen
  patchChildren(current, next)
}
