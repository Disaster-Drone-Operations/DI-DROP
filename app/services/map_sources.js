// Open map data for the map in the large view and the mission map – all allow showing and exporting with attribution:
//   Map:    basemap.de Web Vektor (BKG), CC BY 4.0 – "© basemap.de / BKG" (comes with the style's source)
//   Aerial: Digitale Orthophotos Thüringen (TLBG, WMS "TH DOP", 20 cm), CC BY 4.0 – "© GDI-Th" – only Thuringia
//   Heights: Terrain Tiles (Mapzen/AWS Open Data; SRTM, Copernicus EU-DEM …) – app/services/terrain.js
// Online only for now (offline package: TODO.md).

export const BASEMAP_STYLE = 'https://sgx.geodatenzentrum.de/gdz_basemapde_vektor/styles/bm_web_col.json'

const DOP_WMS = 'https://www.geoproxy.geoportal-th.de/geoproxy/services/DOP?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap' +
  '&LAYERS=th_dop&STYLES=&FORMAT=image/jpeg&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=512&HEIGHT=512'

// Thuringia (a little generous) – outside of it there are no aerial images
export const AERIAL_BOUNDS = [9.85, 50.15, 12.7, 51.7]

export const ATTRIBUTION = {
  aerial: '© <a href="https://www.geoportal-th.de">GDI-Th</a> (CC BY 4.0)',
  heights: 'Höhen: Terrain Tiles (Mapzen, AWS Open Data)',
}

export const insideAerial = (lon, lat) => lon >= AERIAL_BOUNDS[0] && lon <= AERIAL_BOUNDS[2] && lat >= AERIAL_BOUNDS[1] && lat <= AERIAL_BOUNDS[3]

// MapLibre style: 'map' (basemap.de) or 'aerial' (orthophotos Thuringia)
export function mapStyle(kind = 'map') {
  if (kind !== 'aerial') return BASEMAP_STYLE
  return {
    version: 8,
    sources: {
      dop: { type: 'raster', tiles: [DOP_WMS], tileSize: 512, bounds: AERIAL_BOUNDS, maxzoom: 20, attribution: ATTRIBUTION.aerial },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#ddd' } },
      { id: 'dop', type: 'raster', source: 'dop' },
    ],
  }
}
