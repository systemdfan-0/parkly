// Офлайн-прогноз: деревья решений из ml/train.py, встроены в сборку как JSON (без сети и сервера).
import model from './model.json';
import type { Lot } from '../data/places';
import { featureVector, type Recent } from './features';

interface Tree { left: number[]; right: number[]; feature: number[]; threshold: number[]; q: (number[] | null)[]; v: (number | null)[] }
interface Model {
  version: number; trainedAt: string; data: string; features: string[]; quantiles: number[];
  horizons: Record<string, Tree>; metrics: Record<string, { mae_tree: number; mae_persistence: number }>;
}
const M = model as unknown as Model;
export const ML_INFO = { trainedAt: M.trainedAt, data: M.data, metrics: M.metrics };
export const ML_HORIZONS = Object.keys(M.horizons).map(Number).sort((a, b) => a - b); // [5, 10, 15]
export const ML_MAX_H = ML_HORIZONS[ML_HORIZONS.length - 1];

/** Лист дерева: среднее изменение свободных мест и его квантили (в долях вместимости). */
function leaf(t: Tree, x: number[]) {
  let n = 0;
  // sklearn сравнивает признаки во float32 — повторяем это, чтобы APK давал ровно тот же лист
  while (t.left[n] !== -1) n = Math.fround(x[t.feature[n]]) <= t.threshold[n] ? t.left[n] : t.right[n];
  return { v: t.v[n]!, q: t.q[n]! };
}

export interface MLBand { lo: number; mid: number; hi: number; pFree: number }

/** Прогноз ровно на обученный горизонт h (5, 10 или 15 мин). */
export function predictAt(lot: Lot, ms: number, r: Recent, h: number): { q: number[]; mean: number; band: MLBand } {
  const x = featureVector(lot.type, lot.capacity, ms, r);
  const lf = leaf(M.horizons[String(h)], x);
  const clamp = (d: number) => Math.min(lot.capacity, Math.max(0, r.now + d * lot.capacity));
  const q = lf.q.map(clamp);
  const mean = clamp(lf.v);
  return { q, mean, band: bandFrom(q, mean) };
}

const QL = M.quantiles;
function at(q: number[], level: number) {
  const i = QL.findIndex((l) => l >= level);
  if (i <= 0) return q[0];
  const f = (level - QL[i - 1]) / (QL[i] - QL[i - 1]);
  return q[i - 1] + f * (q[i] - q[i - 1]);
}
/** P(свободно ≥ 1) по распределению из листа: где квантильная кривая пересекает 0,5 места. */
function pAtLeastOne(q: number[]) {
  if (q[0] >= 0.5) return 1;
  if (q[q.length - 1] < 0.5) return 0; // во всех квантилях листа — 0 мест
  for (let i = 1; i < q.length; i++) {
    if (q[i] >= 0.5) {
      const f = q[i] === q[i - 1] ? 0 : (0.5 - q[i - 1]) / (q[i] - q[i - 1]);
      return 1 - (QL[i - 1] + f * (QL[i] - QL[i - 1]));
    }
  }
  return 0;
}
/** Точечный прогноз — среднее листа (то, что предсказывает дерево), диапазон — 20–80% квантили листа. */
function bandFrom(q: number[], mean: number): MLBand {
  return { lo: Math.round(at(q, 0.2)), mid: Math.round(mean), hi: Math.round(at(q, 0.8)), pFree: pAtLeastOne(q) };
}

/**
 * Прогноз на произвольный горизонт 0..15 мин: линейно между соседними обученными горизонтами
 * (0 мин — текущий замер). Для горизонта больше 15 мин возвращает null — тогда работает эвристика.
 */
export function predictML(lot: Lot, ms: number, r: Recent, horizon: number): MLBand | null {
  if (horizon > ML_MAX_H) return null;
  const hs = [0, ...ML_HORIZONS];
  let i = hs.findIndex((h) => h >= horizon);
  if (i <= 0) i = 1;
  const h0 = hs[i - 1], h1 = hs[i];
  const p0 = h0 === 0 ? { q: QL.map(() => r.now), mean: r.now } : predictAt(lot, ms, r, h0);
  const p1 = predictAt(lot, ms, r, h1);
  const f = (horizon - h0) / (h1 - h0);
  return bandFrom(p0.q.map((v, k) => v + f * (p1.q[k] - v)), p0.mean + f * (p1.mean - p0.mean));
}
