// Ordnernamen, die unter macOS und Windows gültig sind

const RESERVED_WINDOWS = /^(con|prn|aux|nul|com\d|lpt\d)$/i

export function sanitizeFolderName(name) {
  const clean = String(name ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
  return RESERVED_WINDOWS.test(clean) ? `${clean}_` : clean || 'Ohne Namen'
}

// "2026-10-06" → "2026_10_06",  "2026-10-06T14:30" → "2026_10_06__14_30"
export const dateFolder = (date) => date.slice(0, 10).replaceAll('-', '_')
export const dateTimeFolder = (dateTime) => `${dateFolder(dateTime)}__${dateTime.slice(11, 13)}_${dateTime.slice(14, 16)}`
