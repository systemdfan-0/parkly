// Подбор парковок из каталога OSM. Здесь нет занятости и почти нет цен — только то, что указано в OSM.
// Ранжирование: пешком до входа, доступ (частные учитываем, но ниже и с пометкой), известная цена.
import type { Priority } from '../engine/recommend';
import { WALK_DETOUR, WALK_M_PER_MIN, fmtDist } from '../engine/geo';
import { catalogNear, distM, type CatalogLot, type CatKind } from './data';

export const NO_DATA = 'Нет данных';

export const CAT_KIND_LABEL: Record<CatKind, string> = {
  surface: 'Наземная парковка', multilevel: 'Многоуровневый паркинг', underground: 'Подземный паркинг', street: 'Парковка вдоль улицы',
};

export function lotTitle(l: CatalogLot): string {
  return l.name || (l.kind ? CAT_KIND_LABEL[l.kind] : 'Парковка');
}

/** Цена за час, если её можно понять из OSM: 0 — бесплатно; null — не указана. */
export function perHourOf(l: CatalogLot): number | null {
  if (l.fee === 0) return 0;
  const m = l.charge.match(/(\d[\d\s]*)\s*(kzt|тг|тенге|₸|т)?\s*(\/|в|за|per)?\s*(h|hr|hour|час|ч)\b/i);
  return m ? parseInt(m[1].replace(/\s/g, ''), 10) : null;
}

export function feeText(l: CatalogLot): string {
  const ph = perHourOf(l);
  if (ph === 0) return 'Бесплатно (OSM)';
  if (ph != null) return `${ph} ₸/ч (OSM)`;
  if (l.fee === 1) return l.charge ? `Платно: ${l.charge}` : 'Платно, цена: нет данных';
  return NO_DATA;
}
export function accessText(l: CatalogLot): string {
  return l.access === 'public' ? 'Для всех' : l.access === 'customers' ? 'Для клиентов' : l.access === 'private' ? 'Частная — по пропуску' : NO_DATA;
}
export const capText = (l: CatalogLot) => (l.cap != null ? `${l.cap} мест` : NO_DATA);

export interface CatOption {
  lot: CatalogLot;
  title: string;
  distM: number;
  walkM: number;
  walkMin: number;
  perHour: number | null;
  score: number;
  tags: ('best' | 'closest' | 'free' | 'private')[];
  /** Подходит ли под бюджет: true — цена известна и в пределах; null — цена неизвестна. */
  inBudget: boolean | null;
}

export interface CatResult {
  options: CatOption[];
  radius: number;
  /** Сколько вариантов отсеяно бюджетом (цена выше) и сколько с неизвестной ценой. */
  overBudget: number;
  unknownPrice: number;
}

const W: Record<Priority, { walk: number; price: number; data: number }> = {
  balanced: { walk: 1, price: 1, data: 1 }, close: { walk: 2.4, price: 0.3, data: 0.5 },
  cheap: { walk: 0.6, price: 2.5, data: 1 }, reliable: { walk: 0.8, price: 0.6, data: 2.5 },
};

export function rankCatalog(place: { lat: number; lon: number }, lots: CatalogLot[], priority: Priority, budget: number | null, radius: number): CatResult {
  const w = W[priority];
  const opts: CatOption[] = lots.map((l) => {
    const d = distM(place.lat, place.lon, l.lat, l.lon);
    const walkM = d * WALK_DETOUR;
    const walkMin = Math.max(1, Math.ceil(walkM / WALK_M_PER_MIN));
    const perHour = perHourOf(l);
    // штрафы в «минутах»: частная — почти всегда не пустят; цена неизвестна — риск; вместимость неизвестна — риск
    const accessPen = l.access === 'private' ? 30 : l.access === 'customers' ? 4 : 0;
    const pricePen = perHour === 0 ? 0 : perHour != null ? perHour / 50 : l.fee === 1 ? 6 : 3;
    const dataPen = (l.cap == null ? 2 : l.cap < 10 ? 3 : 0) + (l.kind == null ? 1 : 0);
    const score = walkMin * w.walk + accessPen + pricePen * w.price + dataPen * w.data;
    const inBudget = budget == null ? true : perHour == null ? null : perHour <= budget;
    return { lot: l, title: lotTitle(l), distM: d, walkM, walkMin, perHour, score, tags: [], inBudget };
  });
  let pool = opts;
  let overBudget = 0, unknownPrice = 0;
  if (budget != null) {
    overBudget = opts.filter((o) => o.inBudget === false).length;
    unknownPrice = opts.filter((o) => o.inBudget === null).length;
    pool = opts.filter((o) => o.inBudget === true);
  }
  pool.sort((a, b) => a.score - b.score || a.distM - b.distM);
  if (pool.length) {
    pool[0].tags.push('best');
    const closest = [...pool].sort((a, b) => a.distM - b.distM)[0];
    if (closest !== pool[0]) closest.tags.push('closest');
    for (const o of pool) {
      if (o.perHour === 0) o.tags.push('free');
      if (o.lot.access === 'private') o.tags.push('private');
    }
  }
  const rest = budget != null ? opts.filter((o) => o.inBudget !== true).sort((a, b) => a.distM - b.distM) : [];
  return { options: [...pool, ...rest], radius, overBudget, unknownPrice };
}

/** Парковки каталога у места назначения: 800 м, если пусто — 1,5 и 3 км. */
export async function catalogFor(place: { lat: number; lon: number }, priority: Priority, budget: number | null): Promise<CatResult> {
  for (const r of [800, 1500, 3000]) {
    const lots = await catalogNear(place.lat, place.lon, r);
    if (lots.length) return rankCatalog(place, lots, priority, budget, r);
  }
  return { options: [], radius: 3000, overBudget: 0, unknownPrice: 0 };
}

export const distText = (o: CatOption) => `${fmtDist(o.distM)}, ${o.walkMin} мин пешком`;
