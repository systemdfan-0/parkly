// Классификатор намерений Пина: логистическая регрессия на хешированных буквенных n-граммах (2–4) и словах.
// Обучается в ml/intent.task.ts на размеченных фразах (с опечатками, сленгом, казахскими словами),
// проверяется на отложенных фразах. В телефоне — тот же код признаков, что при обучении.
import { fold } from '../catalog/text';

export const DIM = 2048;

/** FNV-1a 32 бита — одинаково в обучении и в приложении. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** Признаки: слова и n-граммы букв внутри слов (с границами), счётчики, нормированные по длине. */
export function featurize(text: string): Map<number, number> {
  const t = fold(text);
  const f = new Map<number, number>();
  const add = (k: string, w: number) => { const i = hash(k) % DIM; f.set(i, (f.get(i) ?? 0) + w); };
  const words = t.split(' ').filter(Boolean);
  for (const w of words) {
    add('w:' + w, 1);
    const s = `<${w}>`;
    for (let n = 2; n <= 4; n++) for (let i = 0; i + n <= s.length; i++) add(s.slice(i, i + n), 0.5);
  }
  for (let i = 0; i + 1 < words.length; i++) add(`b:${words[i]}_${words[i + 1]}`, 0.7);
  let norm = 0; for (const v of f.values()) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (const [k, v] of f) f.set(k, v / norm);
  return f;
}

export interface IntentModel { labels: string[]; dim: number; scale: number; w: string; b: number[]; acc: number; nTrain: number; nTest: number; trainedAt: string }

let W: Int8Array | null = null, Wfor: IntentModel | null = null;
const weights = (m: IntentModel) => {
  if (W && Wfor === m) return W;
  const bin = atob(m.w); // есть и в браузере, и в Node 16+
  W = new Int8Array(bin.length); for (let i = 0; i < bin.length; i++) W[i] = (bin.charCodeAt(i) << 24) >> 24;
  Wfor = m; return W;
};

/** Вероятности намерений (softmax). */
export function classify(m: IntentModel, text: string): { label: string; p: number }[] {
  const x = featurize(text), w = weights(m), K = m.labels.length;
  const z = m.b.slice();
  for (const [i, v] of x) for (let k = 0; k < K; k++) z[k] += (w[k * m.dim + i] * m.scale) * v;
  const mx = Math.max(...z); const e = z.map((v) => Math.exp(v - mx)); const s = e.reduce((a, b) => a + b, 0);
  return m.labels.map((label, k) => ({ label, p: e[k] / s })).sort((a, b) => b.p - a.p);
}
