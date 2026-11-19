// Каталог парковок Казахстана из OpenStreetMap (catalog/import.py → public/catalog/).
// Файлы лежат внутри приложения: работает без сети. Парковки грузятся по квадратам 0,25° —
// только для того района, который сейчас на карте.

export type CatKind = 'surface' | 'multilevel' | 'underground' | 'street';
export type CatAccess = 'public' | 'customers' | 'private';

export interface CatalogLot {
  id: string;            // osm:n123 / osm:w123 / osm:r123
  osm: string;           // n123 — для ссылки на openstreetmap.org
  lat: number;
  lon: number;
  name: string;
  kk: string;
  kind: CatKind | null;
  cap: number | null;
  fee: 0 | 1 | null;     // 0 — бесплатно, 1 — платно, null — нет данных
  access: CatAccess | null;
  hours: string;
  op: string;
  charge: string;
  area: number;          // м², для полигонов
  city: number;          // индекс в index.cities, −1 — вне населённых пунктов
  entr: [number, number] | null; // въезд (amenity=parking_entrance), если отмечен в OSM
}

export interface City {
  i: number; ru: string; kk: string; en: string; alt: string[]; lat: number; lon: number;
  place: 'city' | 'town' | 'village'; pop: number | null; region: number; lots: number; poi: number;
}
export interface Region { i: number; ru: string; kk: string; en: string; lots: number; cities: number }
export interface Source {
  name: string; url: string; file: string; md5: string; md5Verified: boolean; extractDate: string; license: string; importedAt: string;
}
export interface CatalogStats {
  lots: number; points: number; polygons: number; named: number; capacity: number; fee_known: number; fee_free: number; fee_paid: number;
  access: Record<string, number>; kind: Record<string, number>; hours: number; no_city: number; excluded_garage_boxes: number; places: number; cities: number;
}
export interface CatalogIndex {
  source: Source; cellSize: number; stats: CatalogStats; regions: Region[]; cities: City[];
  cells: { key: string; n: number; lat: number; lon: number }[];
}
export interface Poi { i: number; ru: string; kk: string; en: string; alt: string[]; lat: number; lon: number; cat: string; city: number }

type Reader = (path: string) => Promise<unknown>;
let reader: Reader = async (p) => {
  const r = await fetch(`./catalog/${p}`);
  if (!r.ok) throw new Error(`каталог: ${p} — ${r.status}`);
  return r.json();
};
/** Для тестов в Node: читать файлы с диска. */
export function setCatalogReader(fn: Reader) { reader = fn; idx = null; idxP = null; cells.clear(); cellP.clear(); byId.clear(); poiP = null; pois = null; }

let idx: CatalogIndex | null = null;
let idxP: Promise<CatalogIndex> | null = null;
export function loadIndex(): Promise<CatalogIndex> {
  if (idx) return Promise.resolve(idx);
  idxP ??= reader('index.json').then((raw) => {
    const r = raw as Omit<CatalogIndex, 'cells' | 'cities' | 'regions'> & { cells: [string, number, number, number][]; cities: Omit<City, 'i'>[]; regions: Omit<Region, 'i'>[] };
    idx = {
      ...r,
      cities: r.cities.map((c, i) => ({ ...c, i })),
      regions: r.regions.map((g, i) => ({ ...g, i })),
      cells: r.cells.map(([key, n, lat, lon]) => ({ key, n, lat, lon })),
    };
    return idx;
  }).catch((e) => { idxP = null; throw e; });
  return idxP;
}
export const indexSync = () => idx;

const cells = new Map<string, CatalogLot[]>();
const cellP = new Map<string, Promise<CatalogLot[]>>();
const byId = new Map<string, CatalogLot>();

type Row = [string, number, number, string, string, CatKind | null, number | null, 0 | 1 | null, CatAccess | null, string, string, string, number, number, ([number, number] | null)?];

export function loadCell(key: string): Promise<CatalogLot[]> {
  const hit = cells.get(key);
  if (hit) return Promise.resolve(hit);
  let p = cellP.get(key);
  if (!p) {
    p = reader(`cells/${key}.json`).then((raw) => {
      const lots = (raw as Row[]).map(([osm, lat, lon, name, kk, kind, cap, fee, access, hours, op, charge, area, city, entr]): CatalogLot =>
        ({ id: 'osm:' + osm, osm, lat, lon, name, kk, kind, cap, fee, access, hours, op, charge, area, city, entr: entr ?? null }));
      for (const l of lots) byId.set(l.id, l);
      cells.set(key, lots);
      return lots;
    }).catch((e) => { cellP.delete(key); throw e; });
    cellP.set(key, p);
  }
  return p;
}
export const cellSync = (key: string) => cells.get(key) ?? null;
export const catalogLot = (id: string) => byId.get(id) ?? null;
export const isCatalogId = (id: string | null | undefined): id is string => !!id && id.startsWith('osm:');

/** Ключи существующих ячеек, пересекающих прямоугольник. */
export function cellKeysIn(ix: CatalogIndex, s: number, w: number, n: number, e: number): string[] {
  const c = ix.cellSize;
  const have = new Set(ix.cells.map((x) => x.key));
  const out: string[] = [];
  for (let y = Math.floor(s / c); y <= Math.floor(n / c); y++)
    for (let x = Math.floor(w / c); x <= Math.floor(e / c); x++) {
      const k = `${y}_${x}`;
      if (have.has(k)) out.push(k);
    }
  return out;
}

const M_LAT = 111_320;
/** Парковки каталога в радиусе от точки (догружает нужные ячейки). */
export async function catalogNear(lat: number, lon: number, radiusM: number): Promise<CatalogLot[]> {
  const ix = await loadIndex();
  const dLat = radiusM / M_LAT, dLon = radiusM / (M_LAT * Math.cos((lat * Math.PI) / 180));
  const keys = cellKeysIn(ix, lat - dLat, lon - dLon, lat + dLat, lon + dLon);
  const all = (await Promise.all(keys.map(loadCell))).flat();
  return all.filter((l) => distM(lat, lon, l.lat, l.lon) <= radiusM);
}

export function distM(aLat: number, aLon: number, bLat: number, bLon: number) {
  const k = Math.PI / 180;
  const x = (bLon - aLon) * k * Math.cos(((aLat + bLat) / 2) * k), y = (bLat - aLat) * k;
  return 6_371_000 * Math.hypot(x, y);
}

let pois: Poi[] | null = null;
let poiP: Promise<Poi[]> | null = null;
/** Ориентиры для поиска (ТРЦ, театры, вокзалы…), ~13 тыс. — грузятся при первом поиске. */
export function loadPois(): Promise<Poi[]> {
  if (pois) return Promise.resolve(pois);
  poiP ??= reader('places.json').then((raw) => {
    pois = (raw as [string, string, string, string[], number, number, string, number][])
      .map(([ru, kk, en, alt, lat, lon, cat, city], i) => ({ i, ru, kk, en, alt, lat, lon, cat, city }));
    return pois;
  }).catch((e) => { poiP = null; throw e; });
  return poiP;
}
export const poisSync = () => pois;

export function cityName(c: City | undefined | null) { return c ? c.ru : ''; }
