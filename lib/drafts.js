// Entwürfe angefangener Formulare (nur für diese App-Sitzung, sessionStorage).
// Damit geht nichts verloren, wenn man zwischendurch ein anderes Modul öffnet.

const prefix = 'draft:'

export function loadDraft(key) {
  try {
    const raw = sessionStorage.getItem(prefix + key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveDraft(key, entries) {
  try {
    sessionStorage.setItem(prefix + key, JSON.stringify(entries))
  } catch {
    // Speicher nicht verfügbar – dann eben ohne Entwurf
  }
}

export function clearDraft(key) {
  try {
    sessionStorage.removeItem(prefix + key)
  } catch {
    // egal
  }
}

export const hasDraft = (key) => !!loadDraft(key)
