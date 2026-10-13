// Ordner- und Dateinamen, die unter macOS und Windows gültig sind – ohne Leerzeichen
// ("B3 Musterdorf" → "B3_Musterdorf"), damit Links, Nextcloud und Skripte nicht stolpern

const RESERVED_WINDOWS = /^(con|prn|aux|nul|com\d|lpt\d)$/i

export function sanitizeFolderName(name) {
  const clean = String(name ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/[._]+$/, '')
  return RESERVED_WINDOWS.test(clean) ? `${clean}_` : clean || 'Ohne_Namen'
}

// "2026-10-06" → "2026_10_06",  "2026-10-06T14:30" → "2026_10_06__14_30"
export const dateFolder = (date) => date.slice(0, 10).replaceAll('-', '_')
export const dateTimeFolder = (dateTime) => `${dateFolder(dateTime)}__${dateTime.slice(11, 13)}_${dateTime.slice(14, 16)}`
