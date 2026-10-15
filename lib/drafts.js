// Drafts of started forms (only for this app session, sessionStorage).
// So nothing gets lost when opening another module in between.

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
    // Storage not available – then just without a draft
  }
}

export function clearDraft(key) {
  try {
    sessionStorage.removeItem(prefix + key)
  } catch {
    // doesn't matter
  }
}

export const hasDraft = (key) => !!loadDraft(key)
