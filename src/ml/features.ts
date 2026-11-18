import type { LotType } from '../data/places';
import { parts } from '../engine/time';

// Единое описание признаков. Python (ml/train.py) строит те же столбцы в том же порядке —
// совпадение проверяет ml/compare.task.ts на тестовых днях.
export const TYPE_ORDER: LotType[] = ['mall', 'office', 'market', 'street', 'theatre', 'station', 'residential', 'park', 'university', 'stadium'];

export const FEATURES = [
  'hour', 'dow', 'weekend', 'capacity', 'free_frac', 'free', 'd5_frac', 'd10_frac', 'd15_frac',
  ...TYPE_ORDER.map((t) => `type_${t}`),
] as const;

/** Последние замеры свободных мест: сейчас, 5, 10 и 15 минут назад. */
export interface Recent { now: number; m5: number; m10: number; m15: number }

export function featureVector(type: LotType, capacity: number, ms: number, r: Recent): number[] {
  const p = parts(ms);
  const dow = (p.dow + 6) % 7; // 0 = понедельник
  const c = capacity;
  return [
    p.minOfDay / 60, dow, dow >= 5 ? 1 : 0, c, r.now / c, r.now,
    (r.now - r.m5) / c, (r.now - r.m10) / c, (r.now - r.m15) / c,
    ...TYPE_ORDER.map((t) => (t === type ? 1 : 0)),
  ];
}
