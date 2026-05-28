export const MAP_TILE_LAYERS = {
  osm: {
    label: "Standard",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution:
      "Map data: &copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors",
    maxZoom: 19,
  },
  topo: {
    label: "Topographic",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution:
      "Map data: &copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors | Map style: &copy; <a href='https://opentopomap.org'>OpenTopoMap</a> (<a href='https://creativecommons.org/licenses/by-sa/3.0/'>CC-BY-SA</a>)",
    maxZoom: 17,
  },
  cyclosm: {
    label: "CyclOSM",
    url: "https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
    attribution:
      "Map data: &copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors | Map style: &copy; <a href='https://www.cyclosm.org/'>CyclOSM</a>",
    maxZoom: 20,
  },
  cartoDark: {
    label: "Carto Dark Matter",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution:
      "Map data: &copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors | Map style: &copy; <a href='https://carto.com/attributions'>CARTO</a>",
    maxZoom: 19,
  },
  cartoPositron: {
    label: "Carto Positron",
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution:
      "Map data: &copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors | Map style: &copy; <a href='https://carto.com/attributions'>CARTO</a>",
    maxZoom: 19,
  },
  googleRoadmap: {
    label: "Google Maps",
    url: "__google_roadmap__",
    attribution: "Map data &copy;2026 Google",
    maxZoom: 20,
  },
  googleSatellite: {
    label: "Google Satellite",
    url: "__google_satellite__",
    attribution: "Map data &copy;2026 Google",
    maxZoom: 20,
  },
  googleTerrain: {
    label: "Google Terrain",
    url: "__google_terrain__",
    attribution: "Map data &copy;2026 Google",
    maxZoom: 20,
  },
  googleDark: {
    label: "Google Dark",
    url: "__google_dark__",
    attribution: "Map data &copy;2026 Google",
    maxZoom: 20,
  },
} as const;

export type MapTileLayerKey = keyof typeof MAP_TILE_LAYERS;

export const GOOGLE_TILE_LAYER_KEYS = new Set<MapTileLayerKey>([
  "googleRoadmap",
  "googleSatellite",
  "googleTerrain",
  "googleDark",
]);
