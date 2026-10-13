// Größen, Geschwindigkeiten und Restzeiten für Uploads

export function formatBytes(bytes) {
  if (bytes == null) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let i = 0
  while (value >= 1000 && i < units.length - 1) {
    value /= 1000
    i++
  }
  const digits = i === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 1
  return `${value.toFixed(digits).replace('.', ',')} ${units[i]}`
}

export const formatSpeed = (bps) => (bps ? `${formatBytes(bps)}/s` : '')

// "ca. 4 Min.", "ca. 1 Std. 20 Min.", "unter 1 Min."
export function formatDuration(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return ''
  if (seconds < 50) return 'unter 1 Min.'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `ca. ${minutes} Min.`
  const hours = Math.floor(minutes / 60)
  return `ca. ${hours} Std.${minutes % 60 ? ` ${minutes % 60} Min.` : ''}`
}

export const percent = (done, total) => (total ? Math.min(100, Math.round((done / total) * 100)) : 0)

export function categoryLabel(category) {
  return { thermal: 'Wärmebild', comparison: 'Vergleichsbild', visible: 'Sichtbild' }[category] ?? 'Datei'
}
