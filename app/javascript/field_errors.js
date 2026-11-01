// Red field errors ("Stichwort darf nicht leer sein") disappear as soon as the field is filled in –
// the form is checked again on submit anyway. Once no field is marked any more, the hint
// "Bitte prüfe die markierten Felder." above the form (errorSummary in form_helper.js) goes too.

export function install() {
  document.addEventListener('input', clear)
  document.addEventListener('change', clear)
}

function clear(event) {
  const field = event.target.closest?.('.field--invalid')
  if (!field || !String(event.target.value ?? '').trim()) return
  field.classList.remove('field--invalid')
  field.querySelectorAll('.field__error').forEach((error) => error.remove())
  const form = field.closest('form')
  if (form && !form.querySelector('.field--invalid')) form.querySelector('[data-error-summary]')?.remove()
}
