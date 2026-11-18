import type { Lot } from '../data/places';
import { PROFILES, AVG_STAY } from './profiles';
import { MIN, parts, isWeekend } from './time';

// ───────────────────────── случайные числа (воспроизводимые)
export interface Rng { s: number }
export function rngNext(r: Rng): number {
  // mulberry32
  r.s = (r.s + 0x6d2b79f5) | 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
export function poisson(lambda: number, r: Rng): number {
  if (lambda <= 0) return 0;
  if (lambda > 30) {
    // нормальное приближение
    const u = Math.max(1e-9, rngNext(r)), v = rngNext(r);
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return Math.max(0, Math.round(lambda + z * Math.sqrt(lambda)));
  }
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rngNext(r); } while (p > L);
  return k - 1;
}

// ───────────────────────── часы работы
export function isOpenAt(lot: Lot, ms: number): boolean {
  if (lot.closedReason) return false;
  if (!lot.hours) return true;
  const h = parts(ms).minOfDay / 60;
  const [o, c] = lot.hours;
  return h >= o && h < c;
}
/** Ближайшее закрытие после ms (или null, если круглосуточно / уже закрыта). */
export function nextCloseMs(lot: Lot, ms: number): number | null {
  if (!lot.hours || !isOpenAt(lot, ms)) return null;
  const p = parts(ms);
  return ms + (lot.hours[1] * 60 - p.minOfDay) * MIN;
}
export function nextOpenMs(lot: Lot, ms: number): number | null {
  if (lot.closedReason || !lot.hours) return null;
  const p = parts(ms);
  let delta = lot.hours[0] * 60 - p.minOfDay;
  if (delta <= 0) delta += 24 * 60;
  return ms + delta * MIN;
}

// ───────────────────────── модель загрузки
export const TAU = 25; // мин: за сколько отклонение от профиля «рассасывается» (возврат к среднему)

export function profileAt(lot: Lot, ms: number): number {
  const prof = PROFILES[lot.type][isWeekend(ms) ? 'weekend' : 'weekday'];
  const x = parts(ms).minOfDay / 60;
  const i = Math.floor(x) % 24;
  const f = x - Math.floor(x);
  return prof[i] * (1 - f) + prof[(i + 1) % 24] * f;
}

/** Ожидаемый спрос на места (может быть больше ёмкости — значит, часть водителей уезжает искать дальше). */
export function targetOcc(lot: Lot, ms: number): number {
  if (!isOpenAt(lot, ms)) return 0;
  return lot.capacity * profileAt(lot, ms) * lot.factor;
}

/** Интенсивности въезда/выезда, машин в минуту. */
export function rates(lot: Lot, occ: number, ms: number) {
  if (!isOpenAt(lot, ms)) return { inR: 0, outR: occ / 15 };
  const base = occ / AVG_STAY[lot.type];          // обычный оборот: машины уезжают после средней стоянки
  const target = targetOcc(lot, ms);
  const slope = targetOcc(lot, ms + MIN) - target; // как меняется суточный профиль за минуту
  const net = slope + (target - occ) / TAU;        // + возврат к профилю, если сейчас загрузка отличается
  return { inR: base + Math.max(0, net), outR: base + Math.max(0, -net) };
}

/** Один шаг симуляции: сначала уезжают, потом приезжают (если есть место). */
export function stepOcc(lot: Lot, occ: number, reserved: number, ms: number, dtMin: number, r: Rng): number {
  const { inR, outR } = rates(lot, occ, ms);
  const dep = Math.min(occ, poisson(outR * dtMin, r));
  const o = occ - dep;
  const room = Math.max(0, lot.capacity - reserved - o);
  const arr = Math.min(room, poisson(inR * dtMin, r));
  return o + arr;
}

export function initialOcc(lot: Lot, ms: number, seed: number): number {
  const noise = ((hashStr(lot.id + ':' + seed) % 1000) / 1000 - 0.5) * 2; // −1..1
  const amp = Math.min(4, lot.capacity * 0.02);
  const t = targetOcc(lot, ms);
  // при спросе выше ёмкости пара мест всё равно «мигает» за счёт оборота
  const v = t >= lot.capacity - 2 ? lot.capacity - 2 + Math.round(noise) : Math.round(t + noise * amp);
  return Math.max(0, Math.min(lot.capacity, v));
}

// ───────────────────────── брони
export interface Booking {
  id: string;
  code: string;
  lotId: string;
  destName: string;
  createdAt: number;
  arriveAt: number;
  endAt: number;
  durationMin: number;
  price: number;
  status: 'active' | 'cancelled' | 'completed';
  closedAt?: number;
  seeded?: boolean;
}

export function reservedAt(lotId: string, ms: number, bookings: Booking[]): number {
  let n = 0;
  for (const b of bookings) if (b.lotId === lotId && b.status === 'active' && b.createdAt <= ms && b.endAt > ms) n++;
  return n;
}

export function freeNow(lot: Lot, occ: number, ms: number, bookings: Booking[]): number {
  if (!isOpenAt(lot, ms)) return 0;
  return Math.max(0, lot.capacity - occ - reservedAt(lot.id, ms, bookings));
}

// ───────────────────────── прогноз (Монте-Карло по той же модели)
export interface Band { lo: number; mid: number; hi: number; pFree: number }
export interface Forecast extends Band { series: (Band & { t: number })[] }

const quant = (arr: number[], q: number) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(q * (arr.length - 1))))];

const cache = new Map<string, Forecast>();

/**
 * Прогноз свободных мест через horizonMin минут.
 * 240 прогонов модели «въезд/выезд» с шагом 1 минута; диапазон — 20-й и 80-й процентили,
 * шанс — доля прогонов, где к приезду есть хотя бы одно место.
 */
export function forecast(
  lot: Lot, occ0: number, now: number, horizonMin: number, bookings: Booking[],
  opts: { runs?: number; seriesMin?: number; seriesStep?: number } = {},
): Forecast {
  const runs = opts.runs ?? 240;
  const H = Math.max(0, Math.round(horizonMin));
  const seriesMin = opts.seriesMin ?? 0;
  const step = opts.seriesStep ?? 5;
  const total = Math.max(H, seriesMin);
  const ends = bookings
    .filter((b) => b.lotId === lot.id && b.status === 'active' && b.createdAt <= now && b.endAt > now)
    .map((b) => b.endAt);
  const nowMin = Math.floor(now / MIN);
  const key = `${lot.id}|${nowMin}|${occ0}|${ends.join(',')}|${H}|${seriesMin}|${runs}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const sampleAt: number[] = [];
  for (let k = 0; k <= seriesMin; k += step) sampleAt.push(k);
  const samples: number[][] = sampleAt.map(() => []);
  const atH: number[] = [];
  const r: Rng = { s: hashStr(key) };
  const reservedAtStep = (k: number) => { const t = now + k * MIN; let n = 0; for (const e of ends) if (e > t) n++; return n; };
  const resv = Array.from({ length: total + 1 }, (_, k) => reservedAtStep(k));
  const open = Array.from({ length: total + 1 }, (_, k) => isOpenAt(lot, now + k * MIN));

  for (let i = 0; i < runs; i++) {
    let occ = occ0;
    let si = 0;
    for (let k = 0; k <= total; k++) {
      const free = open[k] ? Math.max(0, lot.capacity - occ - resv[k]) : 0;
      if (k === H) atH.push(free);
      if (si < sampleAt.length && sampleAt[si] === k) { samples[si].push(free); si++; }
      if (k < total) occ = stepOcc(lot, occ, resv[k], now + k * MIN, 1, r);
    }
  }
  const band = (vals: number[]): Band => {
    const s = [...vals].sort((a, b) => a - b);
    return { lo: quant(s, 0.2), mid: quant(s, 0.5), hi: quant(s, 0.8), pFree: s.filter((v) => v >= 1).length / s.length };
  };
  const res: Forecast = { ...band(atH), series: samples.map((v, i) => ({ t: now + sampleAt[i] * MIN, ...band(v) })) };
  if (cache.size > 400) cache.clear();
  cache.set(key, res);
  return res;
}
