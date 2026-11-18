import type { Lot, Tariff } from '../data/places';
import { MIN, parts } from './time';

export interface Price { total: number; lines: string[]; freeAll: boolean }

const BLOCK = 30; // тарификация блоками по 30 минут

export const tenge = (n: number) => (n === 0 ? 'бесплатно' : `${n.toLocaleString('ru-RU').replace(/,/g, ' ')} ₸`);

export function tariffLabel(t: Tariff): string {
  if (t.perHour === 0) return 'Бесплатно';
  let s = `${t.perHour} ₸/ч`;
  if (t.freeMin) s += `, первые ${t.freeMin} мин бесплатно`;
  if (t.paidFrom != null) s += `, платно ${t.paidFrom}:00–${t.paidTo}:00`;
  if (t.dailyMax) s += `, не больше ${t.dailyMax} ₸/сутки`;
  return s;
}

/** Стоимость стоянки с startMs длительностью durationMin. */
export function priceFor(lot: Lot, startMs: number, durationMin: number): Price {
  const t = lot.tariff;
  if (t.perHour === 0) return { total: 0, lines: ['Парковка бесплатная'], freeAll: true };
  const freeMin = t.freeMin ?? 0;
  const lines: string[] = [];
  let paidBlocks = 0, freeBlocks = 0;
  for (let m = freeMin; m < durationMin; m += BLOCK) {
    const h = parts(startMs + m * MIN).h;
    const paid = t.paidFrom == null || (h >= t.paidFrom && h < (t.paidTo ?? 24));
    if (paid) paidBlocks++; else freeBlocks++;
  }
  let total = Math.round((paidBlocks * t.perHour) / 2);
  if (freeMin) lines.push(`Первые ${Math.min(freeMin, durationMin)} мин — бесплатно`);
  if (paidBlocks) lines.push(`${paidBlocks} × 30 мин по ${t.perHour / 2} ₸`);
  if (freeBlocks) lines.push(`${freeBlocks * 30} мин вне платных часов — бесплатно`);
  if (t.dailyMax && total > t.dailyMax) { total = t.dailyMax; lines.push(`Ограничено суточным максимумом ${t.dailyMax} ₸`); }
  return { total, lines, freeAll: total === 0 };
}
