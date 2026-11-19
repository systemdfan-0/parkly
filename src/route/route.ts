// Маршруты «на машине» и «пешком» по настоящим улицам.
//   1) 2ГИС Routing API — если пользователь ввёл свой ключ: машина с учётом пробок сейчас, пешком по тротуарам;
//   2) OpenStreetMap (routing.openstreetmap.de, без ключа) — по улицам, но без пробок;
//   3) нет сети — прямая линия с честной пометкой «по прямой».
// Ключ 2ГИС хранится только на телефоне (localStorage), в APK и репозитории его нет.
// В сервис маршрутов уходят только две точки: откуда и куда.

export type RouteMode = 'car' | 'walk';
/** Загруженность участка по 2ГИС: fast — свободно, normal, slow — плотно, jam — пробка. */
export type Jam = 'fast' | 'normal' | 'slow' | 'jam' | null;
export interface RouteSeg { pts: [number, number][]; jam: Jam }
export interface Route {
  mode: RouteMode;
  source: '2gis' | 'osm' | 'line';
  durS: number;
  distM: number;
  /** Обычное время в этот час (статистика 2ГИС) — чтобы показать, насколько пробки добавляют. */
  usualS?: number;
  segs: RouteSeg[];
}
export interface LatLon { lat: number; lon: number }

const KEY = 'parkly-2gis-key';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function get2gisKey(): string | null {
  try { const k = localStorage.getItem(KEY); return k && UUID.test(k) ? k : null; } catch { return null; }
}
export function set2gisKey(k: string | null): boolean {
  const v = (k ?? '').trim();
  try {
    if (!v) { localStorage.removeItem(KEY); return true; }
    if (!UUID.test(v)) return false;
    localStorage.setItem(KEY, v.toLowerCase());
    cache.clear();
    return true;
  } catch { return false; }
}
/** Проверка ключа одним коротким запросом (Алматы, 2 точки). */
export async function check2gisKey(k: string): Promise<'ok' | 'bad' | 'offline'> {
  try {
    const r = await twogis(k, 'car', { lat: 43.238, lon: 76.905 }, { lat: 43.2365, lon: 76.9455 }, 'jam', false);
    return r ? 'ok' : 'bad';
  } catch (e) { return (e as Error).message === 'bad-key' ? 'bad' : 'offline'; }
}

const TIMEOUT = 9000;
async function post(url: string, body: unknown): Promise<any> {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ac.signal });
    if (r.status === 401 || r.status === 403) throw new Error('bad-key');
    return await r.json();
  } finally { clearTimeout(t); }
}
async function get(url: string): Promise<any> {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), TIMEOUT);
  try { const r = await fetch(url, { signal: ac.signal }); return await r.json(); } finally { clearTimeout(t); }
}

/** «LINESTRING(76.9 43.2, 76.91 43.21)» → [[lat, lon], …] */
export function parseLine(wkt: string): [number, number][] {
  const m = /\(([^()]*)\)/.exec(wkt);
  if (!m) return [];
  return m[1].split(',').map((p) => p.trim().split(/\s+/).map(Number)).filter((a) => a.length >= 2 && a.every(Number.isFinite)).map(([lon, lat]) => [lat, lon]);
}
const JAMS = new Set(['fast', 'normal', 'slow', 'jam']);

/** Разбор ответа 2ГИС Routing API 7.0: участки манёвров с цветом загруженности + пешие отрезки в начале и конце. */
export function parse2gis(res: any, mode: RouteMode): Route | null {
  const r = res?.result?.[0];
  if (!r) return null;
  const segs: RouteSeg[] = [];
  const addPath = (path: any) => {
    const gs = Array.isArray(path?.geometry) ? path.geometry : path?.geometry ? [path.geometry] : [];
    for (const g of gs) {
      const pts = parseLine(g.selection ?? '');
      if (pts.length >= 2) segs.push({ pts, jam: mode === 'car' && JAMS.has(g.color) ? g.color : null });
    }
  };
  addPath(r.begin_pedestrian_path);
  for (const m of r.maneuvers ?? []) addPath(m.outcoming_path);
  addPath(r.end_pedestrian_path);
  return { mode, source: '2gis', durS: r.total_duration ?? 0, distM: r.total_distance ?? 0, segs };
}

async function twogis(key: string, mode: RouteMode, a: LatLon, b: LatLon, traffic: 'jam' | 'statistics', detailed = true): Promise<Route | null> {
  const body: Record<string, unknown> = {
    points: [{ type: 'stop', lon: a.lon, lat: a.lat }, { type: 'stop', lon: b.lon, lat: b.lat }],
    transport: mode === 'car' ? 'driving' : 'walking',
    output: detailed ? 'detailed' : 'summary',
  };
  if (mode === 'car') { body.route_mode = 'fastest'; body.traffic_mode = traffic; }
  const res = await post(`https://routing.api.2gis.com/routing/7.0.0/global?key=${encodeURIComponent(key)}`, body);
  if (res?.status && res.status !== 'OK') {
    if (/key/i.test(res?.message ?? '')) throw new Error('bad-key');
    return null;
  }
  if (!detailed) { const s = res?.result?.[0]; return s ? { mode, source: '2gis', durS: s.duration ?? s.total_duration, distM: s.length ?? s.total_distance, segs: [] } : null; }
  return parse2gis(res, mode);
}

async function osm(mode: RouteMode, a: LatLon, b: LatLon): Promise<Route | null> {
  const prof = mode === 'car' ? 'routed-car' : 'routed-foot';
  const res = await get(`https://routing.openstreetmap.de/${prof}/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson`);
  const r = res?.routes?.[0];
  if (!r) return null;
  const pts = (r.geometry?.coordinates ?? []).map(([lon, lat]: [number, number]) => [lat, lon] as [number, number]);
  return { mode, source: 'osm', durS: r.duration, distM: r.distance, segs: [{ pts, jam: null }] };
}

function crow(a: LatLon, b: LatLon) {
  const k = Math.PI / 180, x = (b.lon - a.lon) * k * Math.cos(((a.lat + b.lat) / 2) * k), y = (b.lat - a.lat) * k;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}
/** Без сети: прямая, время — с запасом на повороты (пешком 4,5 км/ч, машина 25 км/ч по городу). */
export function lineRoute(mode: RouteMode, a: LatLon, b: LatLon): Route {
  const d = crow(a, b) * 1.3;
  return { mode, source: 'line', distM: d, durS: d / (mode === 'car' ? 25 / 3.6 : 4.5 / 3.6), segs: [{ pts: [[a.lat, a.lon], [b.lat, b.lon]], jam: null }] };
}

const cache = new Map<string, { at: number; p: Promise<Route> }>();
const TTL = 3 * 60_000;
const r4 = (x: number) => x.toFixed(4);

/** Маршрут с кэшем на 3 минуты: 2ГИС (если есть ключ) → OSM → прямая. */
export function getRoute(mode: RouteMode, a: LatLon, b: LatLon): Promise<Route> {
  const key = get2gisKey();
  const id = `${mode}:${key ? 'g' : 'o'}:${r4(a.lat)},${r4(a.lon)}:${r4(b.lat)},${r4(b.lon)}`;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL) return hit.p;
  const p = (async () => {
    if (key) {
      try {
        const [now, usual] = await Promise.all([
          twogis(key, mode, a, b, 'jam'),
          mode === 'car' ? twogis(key, mode, a, b, 'statistics', false).catch(() => null) : Promise.resolve(null),
        ]);
        if (now && now.segs.length) return { ...now, usualS: usual?.durS };
      } catch { /* ключ не подошёл или нет сети — пробуем OSM */ }
    }
    try { const o = await osm(mode, a, b); if (o && o.segs[0].pts.length >= 2) return o; } catch { /* нет сети */ }
    return lineRoute(mode, a, b);
  })();
  cache.set(id, { at: Date.now(), p });
  p.then((r) => { if (r.source === 'line') cache.delete(id); }, () => cache.delete(id));
  return p;
}

export const fmtDur = (s: number) => {
  const m = Math.max(1, Math.round(s / 60));
  return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${m % 60 ? `${m % 60} мин` : ''}`.trim();
};
export const JAM_COLOR: Record<string, string> = { fast: '#2FB36B', normal: '#9BCB3C', slow: '#F5A623', jam: '#E8473C' };
/** Доля пути по загруженности — для полоски «свободно / плотно / пробка». */
export function jamShare(r: Route): Record<'fast' | 'normal' | 'slow' | 'jam', number> {
  const acc = { fast: 0, normal: 0, slow: 0, jam: 0 };
  let total = 0;
  for (const s of r.segs) {
    let d = 0;
    for (let i = 1; i < s.pts.length; i++) d += crow({ lat: s.pts[i - 1][0], lon: s.pts[i - 1][1] }, { lat: s.pts[i][0], lon: s.pts[i][1] });
    total += d;
    if (s.jam) acc[s.jam] += d;
  }
  if (total > 0) for (const k of Object.keys(acc) as (keyof typeof acc)[]) acc[k] /= total;
  return acc;
}
