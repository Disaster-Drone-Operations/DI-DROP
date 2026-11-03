// Terrain heights for the image footprint (footprint.js): Terrain Tiles ("terrarium", AWS Open Data, about 30 m in
// Germany) – loaded around a point, then sampled synchronously. Online only; without them footprint() uses a plane.
//
//   const ground = await groundAround(lat, lon)   // → (lat, lon) → metres above sea level, or null (offline)

const TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
const ZOOM = 14 // ≈ 9.5 m per pixel in Germany – the data itself is coarser
const tiles = new Map() // "z/x/y" → Promise<ImageData | null>

const tileXY = (lat, lon, z = ZOOM) => {
  const n = 2 ** z
  const x = ((lon + 180) / 360) * n
  const latRad = (lat * Math.PI) / 180
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  return { x, y }
}

function loadTile(x, y, z = ZOOM) {
  const key = `${z}/${x}/${y}`
  if (!tiles.has(key)) {
    tiles.set(key, fetch(TILE_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y))
      .then((res) => (res.ok ? res.blob() : null))
      .then(async (blob) => {
        if (!blob) return null
        const bitmap = await createImageBitmap(blob)
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(bitmap, 0, 0)
        bitmap.close?.()
        return ctx.getImageData(0, 0, canvas.width, canvas.height)
      })
      .catch(() => {
        tiles.delete(key) // try again later (e.g. back online)
        return null
      }))
    while (tiles.size > 64) tiles.delete(tiles.keys().next().value)
  }
  return tiles.get(key)
}

// Height of one pixel: terrarium encoding (R · 256 + G + B / 256) − 32768
const heightAt = (data, px, py) => {
  const i = (Math.min(data.height - 1, Math.max(0, py)) * data.width + Math.min(data.width - 1, Math.max(0, px))) * 4
  return data.data[i] * 256 + data.data[i + 1] + data.data[i + 2] / 256 - 32768
}

// Tiles within radius metres around the point → sampler (bilinear) or null if none could be loaded
export async function groundAround(lat, lon, radius = 700) {
  const degLat = radius / 111_320
  const degLon = radius / (111_320 * Math.cos((lat * Math.PI) / 180))
  const a = tileXY(lat + degLat, lon - degLon)
  const b = tileXY(lat - degLat, lon + degLon)
  const loaded = new Map()
  for (let x = Math.floor(a.x); x <= Math.floor(b.x); x++) {
    for (let y = Math.floor(a.y); y <= Math.floor(b.y); y++) loaded.set(`${x}/${y}`, loadTile(x, y))
  }
  const datas = new Map()
  for (const [key, promise] of loaded) datas.set(key, await promise)
  if (![...datas.values()].some(Boolean)) return null
  return (pLat, pLon) => {
    const { x, y } = tileXY(pLat, pLon)
    const data = datas.get(`${Math.floor(x)}/${Math.floor(y)}`)
    if (!data) return null
    const fx = (x - Math.floor(x)) * data.width - 0.5
    const fy = (y - Math.floor(y)) * data.height - 0.5
    const [x0, y0] = [Math.floor(fx), Math.floor(fy)]
    const [tx, ty] = [fx - x0, fy - y0]
    const h = (dx, dy) => heightAt(data, x0 + dx, y0 + dy)
    return (h(0, 0) * (1 - tx) + h(1, 0) * tx) * (1 - ty) + (h(0, 1) * (1 - tx) + h(1, 1) * tx) * ty
  }
}
