import { LOTS } from '../data/places';
import { initialOcc, type Booking } from './model';
import { almatyMs, parts, MIN } from './time';

export interface Scenario { id: string; label: string; hint: string; dayKind: 'weekday' | 'saturday' | 'today'; h: number; m: number }

export const SCENARIOS: Scenario[] = [
  { id: 'evening', label: 'Будни, 18:25', hint: 'Вечерний пик: ТРЦ полные, офисы разъезжаются', dayKind: 'weekday', h: 18, m: 25 },
  { id: 'morning', label: 'Будни, 8:40', hint: 'Утро: бизнес-центры и улицы заполняются', dayKind: 'weekday', h: 8, m: 40 },
  { id: 'lunch', label: 'Будни, 13:10', hint: 'День: рынок на пике, ТРЦ свободнее', dayKind: 'weekday', h: 13, m: 10 },
  { id: 'night', label: 'Будни, 23:10', hint: 'Ночь: улицы бесплатно, рынок закрыт', dayKind: 'weekday', h: 23, m: 10 },
  { id: 'saturday', label: 'Суббота, 15:00', hint: 'Выходной: ТРЦ, парки и Медеу заняты', dayKind: 'saturday', h: 15, m: 0 },
  { id: 'live', label: 'Сейчас', hint: 'Текущее время Алматы', dayKind: 'today', h: -1, m: -1 },
];

export const DEFAULT_SCENARIO = 'evening';
export const DEMO_SEED = 2026;

export function scenarioStart(sc: Scenario, realNow = Date.now()): number {
  if (sc.dayKind === 'today') return Math.floor(realNow / MIN) * MIN;
  const p = parts(realNow);
  let day = almatyMs(p.y, p.mo, p.d, sc.h, sc.m);
  const dowOf = (ms: number) => parts(ms).dow;
  if (sc.dayKind === 'weekday') while (dowOf(day) === 0 || dowOf(day) === 6) day += 24 * 60 * MIN;
  if (sc.dayKind === 'saturday') while (dowOf(day) !== 6) day += 24 * 60 * MIN;
  return day;
}

/** Замеры за 15 минут до старта сценария — по суточному профилю (тот же шум, что у текущего значения). */
export function initialHistory(ms: number, seed = DEMO_SEED): Record<string, number[]> {
  return Object.fromEntries(LOTS.map((l) => [l.id, Array.from({ length: 16 }, (_, k) => initialOcc(l, ms - (15 - k) * MIN, seed))]));
}

export function initialOccupancy(ms: number, seed = DEMO_SEED): Record<string, number> {
  return Object.fromEntries(LOTS.map((l) => [l.id, initialOcc(l, ms, seed)]));
}

/** Несколько прошлых поездок, чтобы история расходов не была пустой. Помечены как демо. */
export function seededHistory(now: number): Booking[] {
  const day = 24 * 60 * MIN;
  const mk = (id: string, lotId: string, destName: string, daysAgo: number, h: number, m: number, dur: number, price: number): Booking => {
    const p = parts(now - daysAgo * day);
    const arriveAt = almatyMs(p.y, p.mo, p.d, h, m);
    return { id, code: id.slice(-4).toUpperCase(), lotId, destName, createdAt: arriveAt - 14 * MIN, arriveAt, endAt: arriveAt + dur * MIN, durationMin: dur, price, status: 'completed', seeded: true };
  };
  return [
    mk('seed-k7q2', 'es-under', 'Esentai Mall', 2, 19, 10, 120, 1000),
    mk('seed-m3x9', 'gb-multi', 'Зелёный базар', 5, 11, 30, 90, 450),
    mk('seed-p8d4', 'mega-under', 'MEGA Alma-Ata', 9, 14, 0, 180, 0),
  ];
}
