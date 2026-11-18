// Подложка карты.
// Основная — векторная OpenFreeMap (данные OpenStreetMap, без ключа и лимитов): чёткая на любом экране,
// подписи по-русски. Если WebGL недоступен или стиль не загрузился — растровые плитки OSM.
import L from 'leaflet';
import { Map as GLMap, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// воркер MapLibre собираем сами: после сборки Vite путь «рядом с модулем» не работает
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

setWorkerUrl(workerUrl);

export const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const ATTR_OSM = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';
const ATTR_OFM = `<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> ${ATTR_OSM}`;

export interface BaseEvents { onLoad: () => void; onError: () => void }

function webgl(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

/**
 * Векторная карта MapLibre как слой Leaflet: холст лежит в панели плиток, а вид (центр, масштаб)
 * повторяет карту Leaflet. Метки, кластеры и жесты остаются на Leaflet.
 */
const PAD = 0.15; // запас холста по краям, чтобы при сдвиге не мелькали пустые края
class VectorBase extends L.Layer {
  private el!: HTMLDivElement;
  gl!: GLMap;
  constructor(private style: object) { super(); }
  onAdd(map: L.Map) {
    this.el = L.DomUtil.create('div', 'base-vector', map.getPane('tilePane')) as HTMLDivElement;
    this.el.style.position = 'absolute';
    this.size(map);
    const c = map.getCenter();
    this.gl = new GLMap({
      container: this.el, style: this.style as never, interactive: false, attributionControl: false,
      center: [c.lng, c.lat], zoom: map.getZoom() - 1, fadeDuration: 0, pixelRatio: Math.min(window.devicePixelRatio || 1, 3),
    });
    map.on('move zoom viewreset', this.sync, this);
    map.on('resize', this.resize, this);
    map.on('zoomanim', this.anim, this);
    return this;
  }
  onRemove(map: L.Map) {
    map.off('move zoom viewreset', this.sync, this);
    map.off('resize', this.resize, this);
    map.off('zoomanim', this.anim, this);
    this.gl.remove();
    this.el.remove();
    return this;
  }
  private size(map: L.Map) {
    const s = map.getSize();
    this.el.style.width = `${Math.round(s.x * (1 + 2 * PAD))}px`;
    this.el.style.height = `${Math.round(s.y * (1 + 2 * PAD))}px`;
  }
  private place(map: L.Map) {
    const s = map.getSize();
    L.DomUtil.setPosition(this.el, map.containerPointToLayerPoint([-s.x * PAD, -s.y * PAD]));
  }
  private sync() {
    const map = this._map; if (!map || !this.gl) return;
    this.place(map);
    const c = map.getCenter();
    this.gl.jumpTo({ center: [c.lng, c.lat], zoom: map.getZoom() - 1 });
  }
  private resize() { const map = this._map; if (!map) return; this.size(map); this.gl.resize(); this.sync(); }
  private anim(e: L.ZoomAnimEvent) {
    // плавный зум Leaflet (двойной тап, кнопки): ведём векторную карту к тому же виду
    this.gl.easeTo({ center: [e.center.lng, e.center.lat], zoom: e.zoom - 1, duration: 250 });
  }
}

type Style = { layers: { id: string; type: string; layout?: Record<string, unknown>; paint?: Record<string, unknown> }[] };

/** Подписи по-русски (если есть name:ru), иначе местное название; номера дорог не трогаем. Чуть теплее фон под палитру Parkly. */
export function patchStyle(style: Style): Style {
  for (const l of style.layers) {
    const tf = l.layout?.['text-field'];
    if (tf && JSON.stringify(tf).includes('name')) l.layout!['text-field'] = ['coalesce', ['get', 'name:ru'], ['get', 'name'], ['get', 'name:latin']];
    if (l.id === 'background' && l.paint) l.paint['background-color'] = '#F1F2EE';
  }
  return style;
}

function raster(m: L.Map, ev: BaseEvents) {
  let loaded = 0, errors = 0;
  const t = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, maxNativeZoom: 19, attribution: ATTR_OSM, className: 'base-raster' });
  t.on('tileload', () => { loaded++; ev.onLoad(); });
  t.on('tileerror', () => { errors++; if (errors > 4 && loaded === 0) ev.onError(); });
  t.addTo(m);
  return 'raster' as const;
}

export async function addBase(m: L.Map, ev: BaseEvents, alive: () => boolean): Promise<'vector' | 'raster' | null> {
  if (!webgl()) return raster(m, ev);
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    const style = patchStyle(await fetch(STYLE_URL, { signal: ctl.signal }).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }));
    clearTimeout(timer);
    if (!alive()) return null; // карту уже убрали (повторный монтаж в StrictMode)
    const layer = new VectorBase(style);
    layer.options.attribution = ATTR_OFM;
    layer.addTo(m);
    const mm = layer.gl;
    let ok = false, errs = 0;
    mm.on('data', () => { if (!ok) { ok = true; } ev.onLoad(); });
    mm.on('error', () => { errs++; if (errs > 4 && !ok) ev.onError(); });
    return 'vector';
  } catch {
    // нет сети при первом запуске или стиль недоступен — растровые плитки (их тоже кэширует приложение)
    if (!alive()) return null;
    if (!navigator.onLine) ev.onError();
    return raster(m, ev);
  }
}
