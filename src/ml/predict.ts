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

/** Распределение свободных мест к приезду (квантили QL) — для учёта машин, которые уже едут на парковку. */
export function predictMLDist(lot: Lot, ms: number, r: Recent, horizon: number): { q: number[]; mean: number } | null {
  if (horizon > ML_MAX_H) return null;
  const hs = [0, ...ML_HORIZONS];
  let i = hs.findIndex((h) => h >= horizon);
  if (i <= 0) i = 1;
  const h0 = hs[i - 1], h1 = hs[i];
  const p0 = h0 === 0 ? { q: QL.map(() => r.now), mean: r.now } : predictAt(lot, ms, r, h0);
  const p1 = predictAt(lot, ms, r, h1);
  const f = (horizon - h0) / (h1 - h0);
  return { q: p0.q.map((v, k) => v + f * (p1.q[k] - v)), mean: p0.mean + f * (p1.mean - p0.mean) };
}

/** P(свободно ≥ k) по квантилям; k = 1 — обычный «шанс найти место». */
export function pAtLeast(q: number[], k: number): number {
  const x = k - 0.5;
  if (q[0] >= x) return 1;
  if (q[q.length - 1] < x) return 0;
  for (let i = 1; i < q.length; i++) {
    if (q[i] >= x) {
      const f = q[i] === q[i - 1] ? 0 : (x - q[i - 1]) / (q[i] - q[i - 1]);
      return 1 - (QL[i - 1] + f * (QL[i] - QL[i - 1]));
    }
  }
  return 0;
}
/** Квантиль уровня level (0..1). */
export const quantileAt = (q: number[], level: number) => at(q, level);

// ---------- объяснение прогноза: настоящий путь в дереве ----------
const TYPE_RU: Record<string, string> = {
  mall: 'ТРЦ', office: 'офисы', market: 'рынок', street: 'уличная парковка', theatre: 'театр', station: 'вокзал',
  residential: 'жилой район', park: 'парк', university: 'вуз', stadium: 'стадион',
};
const hm = (h: number) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
const pct = (x: number) => `${Math.round(Math.abs(x) * 100)}%`;

export interface WhyStep { feature: string; text: string }
/**
 * Почему дерево на горизонте h дало такой прогноз: условия на пути от корня до листа,
 * сжатые по признакам (самая узкая граница), — те же сравнения, что делает модель.
 */
export function explainAt(lot: Lot, ms: number, r: Recent, h: number): { steps: WhyStep[]; depth: number; delta: number } {
  const t = M.horizons[String(h)];
  const x = featureVector(lot.type, lot.capacity, ms, r);
  const lo: Record<number, number> = {}, hi: Record<number, number> = {};
  const order: number[] = [];
  let n = 0, depth = 0;
  while (t.left[n] !== -1) {
    const f = t.feature[n], th = t.threshold[n];
    if (!order.includes(f)) order.push(f);
    if (Math.fround(x[f]) <= th) { hi[f] = Math.min(hi[f] ?? Infinity, th); n = t.left[n]; }
    else { lo[f] = Math.max(lo[f] ?? -Infinity, th); n = t.right[n]; }
    depth++;
  }
  const steps: WhyStep[] = [];
  for (const f of order) {
    const name = M.features[f], a = lo[f], b = hi[f];
    let text = '';
    if (name === 'hour') text = a != null && b != null ? `время ${hm(a)}–${hm(b)}` : a != null ? `позже ${hm(a)}` : `раньше ${hm(b!)}`;
    else if (name === 'dow') text = 'день недели';
    else if (name === 'weekend') text = x[f] ? 'выходной' : 'будний день';
    else if (name === 'capacity') text = a != null ? `больше ${Math.round(a)} мест всего` : `до ${Math.round(b!)} мест всего`;
    else if (name === 'free') text = a != null && b != null ? `свободно сейчас ${Math.ceil(a)}–${Math.floor(b)}` : a != null ? `свободно сейчас больше ${Math.floor(a)}` : `свободно сейчас не больше ${Math.floor(b!)}`;
    else if (name === 'free_frac') text = a != null ? `свободно больше ${pct(a)} мест` : b! <= 0.5 ? `свободно меньше ${pct(b!)} мест` : '';
    else if (/^d(5|10|15)_frac$/.test(name)) {
      const mins = name.slice(1, name.indexOf('_'));
      const v = x[f];
      text = Math.abs(v) < 0.005 ? `за ${mins} мин свободных почти не изменилось` : v < 0 ? `за ${mins} мин заняли ${pct(v)} мест` : `за ${mins} мин освободилось ${pct(v)} мест`;
    } else if (name.startsWith('type_')) {
      const ty = name.slice(5);
      text = x[f] ? `тип парковки: ${TYPE_RU[ty] ?? ty}` : ''; // «не офисы» человеку ничего не говорит
    }
    if (text) steps.push({ feature: name, text });
  }
  return { steps, depth, delta: t.v[n]! * lot.capacity };
}
/** Важность признаков модели на горизонте h (доля, из обучения). */
export const featureImportance = (h: number): [string, number][] => ((M.metrics as any)[String(h)]?.top_features ?? []) as [string, number][];
