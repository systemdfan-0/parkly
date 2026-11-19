// Демо «После мероприятия» (СИМУЛЯЦИЯ). Район театра Абая, вечер буднего дня.
// После мероприятия N водителей почти одновременно ищут парковку рядом. Один и тот же поток машин
// (время запроса, время в пути, лимит цены и ходьбы, кто отменит поездку) прогоняем в двух режимах:
//   «independent» — текущий Parkly: каждая рекомендация считается сама по себе (ML-прогноз к приезду);
//   «aware»       — тот же ML-прогноз, но учитывает машины, которые уже выбрали эту парковку и приедут раньше:
//                   шанс = P(свободно к приезду ≥ k + 1), где k — такие ожидаемые прибытия.
// Фоновый поток (обычные водители без Parkly) — модель приложения (rates), случайность зафиксирована seed.
import { DESTINATIONS, LOTS, destToPlace, type Lot } from '../data/places';
import { haversine, WALK_DETOUR, WALK_M_PER_MIN } from './geo';
import { hashStr, initialOcc, isOpenAt, poisson, rates, rngNext, type Rng } from './model';
import { priceFor } from './pricing';
import { AVG_STAY } from './profiles';
import { almatyMs, MIN } from './time';
import { ML_MAX_H, predictMLDist, pAtLeast, quantileAt } from '../ml/predict';
import { SEARCH_PENALTY_MIN, STREET_SEARCH_MIN, TENGE_PER_MIN } from './recommend';

export type Mode = 'independent' | 'aware';

export interface EventSettings {
  cars: number;
  seed: number;
  /** Доля водителей, которые выберут парковку, но потом отменят поездку. */
  cancelShare: number;
  /** За сколько минут все водители делают запрос. */
  windowMin: number;
}
export const DEFAULT_EVENT: EventSettings = { cars: 80, seed: 7, cancelShare: 0.1, windowMin: 20 };
export const EVENT_LEVELS = [20, 40, 80, 120, 160, 200];

export const EVENT_DEST = DESTINATIONS.find((d) => d.id === 'opera')!;
export const EVENT_PLACE = destToPlace(EVENT_DEST);
/** Будни, 18:25 — как в сценарии защиты; дата фиксирована, чтобы прогоны повторялись. */
export const EVENT_START = almatyMs(2026, 10, 18, 18, 25);
/** Демо-парковки в районе театра (до 1,1 км), открытые вечером. */
export const EVENT_LOTS: Lot[] = LOTS.filter((l) => !l.closedReason && haversine(l.lat, l.lon, EVENT_PLACE.lat, EVENT_PLACE.lon) <= 1100 && isOpenAt(l, EVENT_START));

export interface Driver {
  i: number;
  requestAt: number;   // минута от старта, когда спросил Parkly
  drive: number;       // минут в пути
  maxWalk: number;     // готов идти не дольше, мин
  maxPrice: number | null; // ₸ в час, null — без ограничения, 0 — только бесплатно
  cancels: boolean;    // выберет, но не поедет (отменит через 3 минуты)
}

export interface Choice { lot: string; p: number; pIndependent: number; k: number; walk: number; mid: number }
export interface DriverResult extends Driver {
  choice: Choice | null;  // null — нет подходящих по цене и расстоянию
  evals: Choice[];        // как водитель видел каждую подходящую парковку в момент решения
  arrivedFull: boolean;
  parkedAt: string | null; // где в итоге встал (после объезда), null — уехал
  extraMin: number;        // лишние минуты на поиск, если приехал на полную
}
export interface LotStat { id: string; name: string; short: string; capacity: number; assigned: number; fullArrivals: number; peakPct: number; endPct: number; walk: number }
export interface ModeResult {
  mode: Mode;
  drivers: DriverResult[];
  lots: LotStat[];
  chose: number;       // получили рекомендацию и поехали (без отменивших)
  noOption: number;    // подходящих парковок не было
  cancelled: number;
  fullShare: number;   // доля приехавших на полную среди поехавших
  avgWalk: number;     // среднее время пешком у тех, кто встал
  leftArea: number;    // так и не нашли место рядом
}

const walkMin = (l: Lot) => Math.max(1, Math.ceil((l.walkM ?? haversine(l.lat, l.lon, EVENT_PLACE.lat, EVENT_PLACE.lon) * WALK_DETOUR) / WALK_M_PER_MIN));
const perHour = (l: Lot, at: number) => priceFor(l, at, 60).total;

/** Поток водителей — одинаковый для обоих режимов (зависит только от настроек). */
export function makeDrivers(s: EventSettings): Driver[] {
  const r: Rng = { s: hashStr(`event:${s.seed}:${s.cars}`) };
  const out: Driver[] = [];
  for (let i = 0; i < s.cars; i++) {
    const u = rngNext(r);
    out.push({
      i: i + 1,
      requestAt: Math.floor(rngNext(r) * s.windowMin),
      drive: 4 + Math.floor(rngNext(r) * 12),               // 4–15 мин — горизонт ML-модели
      maxWalk: [6, 8, 10, 14][Math.floor(rngNext(r) * 4)],
      maxPrice: u < 0.55 ? null : u < 0.8 ? 350 : u < 0.95 ? 200 : 0, // 5% — только бесплатно
      cancels: rngNext(r) < s.cancelShare,
    });
  }
  return out.sort((a, b) => a.requestAt - b.requestAt || a.i - b.i);
}

/** Сколько машин из уже выбравших эту парковку приедут раньше нас (отменённые не считаются). */
export function expectedBefore(claims: { lot: string; eta: number; active: boolean }[], lot: string, eta: number): number {
  let k = 0;
  for (const c of claims) if (c.active && c.lot === lot && c.eta <= eta) k++;
  return k;
}

const HORIZON = 50; // минут симуляции

export function simulateEvent(s: EventSettings, mode: Mode): ModeResult {
  const drivers = makeDrivers(s);
  const lots = EVENT_LOTS;
  const occ: Record<string, number> = {};
  const hist: Record<string, number[]> = {};
  for (const l of lots) {
    // 15 минут истории до старта — вход ML-модели
    hist[l.id] = Array.from({ length: 16 }, (_, k) => initialOcc(l, EVENT_START - (15 - k) * MIN, s.seed));
    occ[l.id] = hist[l.id][15];
  }
  const peak: Record<string, number> = Object.fromEntries(lots.map((l) => [l.id, occ[l.id]]));
  const claims: { lot: string; eta: number; active: boolean; d: number }[] = [];
  const res: DriverResult[] = drivers.map((d) => ({ ...d, choice: null, evals: [], arrivedFull: false, parkedAt: null, extraMin: 0 }));
  const byI = new Map(res.map((d) => [d.i, d]));
  const arrivals = new Map<number, DriverResult[]>();
  const cancelAt = new Map<number, DriverResult[]>();
  const push = <T,>(m: Map<number, T[]>, t: number, v: T) => { const a = m.get(t); if (a) a.push(v); else m.set(t, [v]); };

  const decide = (d: DriverResult, t: number) => {
    const now = EVENT_START + t * MIN;
    let best: (Choice & { score: number }) | null = null;
    for (const l of lots) {
      const w = walkMin(l);
      const ph = perHour(l, now + d.drive * MIN);
      if (w > d.maxWalk || (d.maxPrice != null && ph > d.maxPrice) || !isOpenAt(l, now + d.drive * MIN)) continue;
      const h = hist[l.id], c = l.capacity, n = h.length;
      const free = (o: number) => Math.max(0, c - o);
      const dist = predictMLDist(l, now, { now: free(occ[l.id]), m5: free(h[n - 6]), m10: free(h[n - 11]), m15: free(h[n - 16]) }, Math.min(d.drive, ML_MAX_H))!;
      const pInd = pAtLeast(dist.q, 1);
      const k = mode === 'aware' ? expectedBefore(claims, l.id, t + d.drive) : 0;
      const p = mode === 'aware' ? pAtLeast(dist.q, k + 1) : pInd;
      // та же формула, что в recommend(): минуты пешком + «минуты риска» + цена в минутах
      const score = w + (1 - p) * SEARCH_PENALTY_MIN + (l.bookable ? 0 : STREET_SEARCH_MIN) + (ph * 2) / TENGE_PER_MIN;
      const ev = { lot: l.id, p, pIndependent: pInd, k, walk: w, mid: Math.round(dist.mean) };
      d.evals.push(ev);
      if (!best || score < best.score) best = { ...ev, score };
    }
    if (!best) return;
    const { score: _s, ...ch } = best;
    void _s;
    d.choice = ch;
    claims.push({ lot: ch.lot, eta: t + d.drive, active: true, d: d.i });
    if (d.cancels) push(cancelAt, t + 3, d);
    else push(arrivals, t + d.drive, d);
  };

  /** Приехал: есть место — встал; нет — объезжает ближайшие подходящие с местами (+3 мин на каждую попытку). */
  const arrive = (d: DriverResult) => {
    const c = claims.find((x) => x.d === d.i);
    if (c) c.active = false;
    const lot = lots.find((l) => l.id === d.choice!.lot)!;
    if (occ[lot.id] < lot.capacity) { occ[lot.id]++; d.parkedAt = lot.id; return; }
    d.arrivedFull = true;
    const alt = lots.filter((l) => l.id !== lot.id && walkMin(l) <= d.maxWalk + 4 && occ[l.id] < l.capacity)
      .sort((a, b) => walkMin(a) - walkMin(b))[0];
    d.extraMin = alt ? 3 : SEARCH_PENALTY_MIN;
    if (alt) { occ[alt.id]++; d.parkedAt = alt.id; }
  };

  for (let t = 0; t <= HORIZON; t++) {
    const now = EVENT_START + t * MIN;
    for (const d of cancelAt.get(t) ?? []) { const c = claims.find((x) => x.d === d.i); if (c) c.active = false; }
    for (const d of arrivals.get(t) ?? []) arrive(d);
    for (const d of res) if (d.requestAt === t) decide(d, t);
    // фон: обычные водители без Parkly (одинаковые случайные числа в обоих режимах)
    for (const l of lots) {
      const r: Rng = { s: hashStr(`${l.id}:${t}:${s.seed}`) };
      const { inR, outR } = rates(l, occ[l.id], now);
      const dep = Math.min(occ[l.id], poisson(outR, r));
      const o = occ[l.id] - dep;
      occ[l.id] = o + Math.min(l.capacity - o, poisson(inR, r));
      hist[l.id].push(occ[l.id]);
      peak[l.id] = Math.max(peak[l.id], occ[l.id]);
    }
  }
  void byI;

  const went = res.filter((d) => d.choice && !d.cancels);
  const parked = res.filter((d) => d.parkedAt);
  const stats: LotStat[] = lots.map((l) => ({
    id: l.id, name: l.name, short: l.short, capacity: l.capacity, walk: walkMin(l),
    assigned: went.filter((d) => d.choice!.lot === l.id).length,
    fullArrivals: went.filter((d) => d.choice!.lot === l.id && d.arrivedFull).length,
    peakPct: peak[l.id] / l.capacity, endPct: occ[l.id] / l.capacity,
  })).sort((a, b) => a.walk - b.walk);
  return {
    mode, drivers: res, lots: stats,
    chose: went.length,
    noOption: res.filter((d) => !d.choice).length,
    cancelled: res.filter((d) => d.choice && d.cancels).length,
    fullShare: went.length ? went.filter((d) => d.arrivedFull).length / went.length : 0,
    avgWalk: parked.length ? parked.reduce((a, d) => a + walkMin(lots.find((l) => l.id === d.parkedAt)!), 0) / parked.length : 0,
    leftArea: went.filter((d) => !d.parkedAt).length,
  };
}

export interface EventCompare { settings: EventSettings; a: ModeResult; b: ModeResult; pin: string | null }

export function compareEvent(s: EventSettings): EventCompare {
  const a = simulateEvent(s, 'independent');
  const b = simulateEvent(s, 'aware');
  return { settings: s, a, b, pin: pinExplain(a, b) };
}

const pct = (p: number) => `${Math.round(p * 100)}%`;
const LOT = Object.fromEntries(LOTS.map((l) => [l.id, l]));

/**
 * Один короткий ответ Пина: почему рекомендация изменилась. Берём первого водителя, которому режимы советуют
 * разное, и числа из его же расчёта в новом режиме: сколько машин из Parkly уже едут на прежний вариант и каким стал шанс.
 */
export function pinExplain(a: ModeResult, b: ModeResult): string | null {
  for (const db of b.drivers) {
    const da = a.drivers.find((x) => x.i === db.i)!;
    if (!da.choice || !db.choice || da.choice.lot === db.choice.lot || db.cancels) continue;
    const old = db.evals.find((e) => e.lot === da.choice!.lot);
    if (!old || old.k === 0) continue;
    const t = EVENT_START + (db.requestAt + db.drive) * MIN;
    const hh = new Date(t + 5 * 60 * MIN).toISOString().slice(11, 16).replace(/^0/, '');
    const cars = `${old.k} ${old.k % 10 === 1 && old.k % 100 !== 11 ? 'машина' : old.k % 10 >= 2 && old.k % 10 <= 4 && (old.k % 100 < 10 || old.k % 100 >= 20) ? 'машины' : 'машин'}`;
    return `«${LOT[db.choice.lot].short}», ${db.choice.walk} мин пешком — шанс ${pct(db.choice.p)}. К ${hh} на «${LOT[old.lot].short}» ждали ${old.mid} свободных мест, но раньше вас туда уже едут ${cars} из Parkly, и шанс падает с ${pct(old.pIndependent)} до ${pct(old.p)}.`;
  }
  return null;
}

/** Сравнение на нескольких уровнях нагрузки — одинаковые исходные условия для обоих режимов. */
export function eventLevels(base: EventSettings = DEFAULT_EVENT) {
  return EVENT_LEVELS.map((cars) => {
    const c = compareEvent({ ...base, cars });
    return { cars, a: c.a, b: c.b };
  });
}
export { quantileAt };
