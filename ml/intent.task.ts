// Обучение классификатора намерений Пина (multinomial logistic regression, хеш-признаки) и проверка
// на ОТЛОЖЕННЫХ фразах: каждая 4-я исходная фраза намерения и все её варианты в обучение не попадают.
// Пишет src/engine/intent-model.json (веса int8) и раздел в ml/REPORT.md. Запуск: npm run ml:intent
import { expect, test } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { INTENTS, TEMPLATES, augment, expand } from './intents';
import { DIM, featurize, classify, type IntentModel } from '../src/engine/intent';

test('классификатор намерений Пина: обучение и проверка на отложенных фразах', () => {
  const labels = Object.keys(INTENTS);
  const train: { x: Map<number, number>; y: number; s: string }[] = [], testSet: { s: string; y: number; base: string }[] = [];
  // фразы намерения: ручные + развёрнутые шаблоны (без дублей)
  const phrases = (lab: string) => [...new Set([...INTENTS[lab], ...(TEMPLATES[lab] ?? []).flatMap((t) => expand(t))])];
  labels.forEach((lab, y) => phrases(lab).forEach((base, i) => {
    const vars = augment(base, (y + 1) * 1000 + i).slice(0, 4);
    if (i % 4 === 3) vars.forEach((s) => testSet.push({ s, y, base }));
    else vars.forEach((s) => train.push({ x: featurize(s), y, s }));
  }));
  const K = labels.length;
  const w = new Float64Array(K * DIM), b = new Float64Array(K);
  // SGD с L2 и убывающим шагом; детерминированный порядок
  let seed = 7; const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const idx = train.map((_, i) => i);
  const L2 = 1e-4;
  for (let ep = 0; ep < 60; ep++) {
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    const lr = 0.5 / (1 + ep * 0.15);
    for (const n of idx) {
      const { x, y } = train[n];
      const z = Array.from(b);
      for (const [f, v] of x) for (let k = 0; k < K; k++) z[k] += w[k * DIM + f] * v;
      const mx = Math.max(...z); const e = z.map((v) => Math.exp(v - mx)); const s = e.reduce((a, c) => a + c, 0);
      for (let k = 0; k < K; k++) {
        const g = e[k] / s - (k === y ? 1 : 0);
        b[k] -= lr * g;
        for (const [f, v] of x) w[k * DIM + f] -= lr * (g * v + L2 * w[k * DIM + f]);
      }
    }
  }
  // квантование int8 → base64 (~70 КБ вместо мегабайта float)
  let mx = 0; for (const v of w) mx = Math.max(mx, Math.abs(v));
  const scale = mx / 127;
  const q = new Int8Array(w.length); for (let i = 0; i < w.length; i++) q[i] = Math.round(w[i] / scale);
  const model: IntentModel = { labels, dim: DIM, scale, w: Buffer.from(q.buffer).toString('base64'), b: Array.from(b, (v) => Math.round(v * 1000) / 1000), acc: 0, nTrain: train.length, nTest: testSet.length, trainedAt: new Date().toISOString().slice(0, 10) };

  // проверка на отложенных фразах — тем же кодом, что в телефоне (int8)
  let ok = 0; const errs: string[] = []; const per: Record<string, [number, number]> = {};
  for (const t of testSet) {
    const p = classify(model, t.s)[0];
    const hit = p.label === labels[t.y];
    ok += +hit; per[labels[t.y]] = [(per[labels[t.y]]?.[0] ?? 0) + +hit, (per[labels[t.y]]?.[1] ?? 0) + 1];
    if (!hit && errs.length < 12) errs.push(`«${t.s}» → ${p.label} (нужно ${labels[t.y]})`);
  }
  model.acc = Math.round((ok / testSet.length) * 1000) / 1000;
  // без «опечаток»: только исходные отложенные фразы
  const bases = [...new Set(testSet.map((t) => t.base))];
  const baseOk = bases.filter((s) => classify(model, s)[0].label === labels[testSet.find((t) => t.base === s)!.y]).length;
  writeFileSync('src/engine/intent-model.json', JSON.stringify(model) + '\n');

  const pc = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')}%`;
  const md = `<!-- intent:start -->
## Пин: классификатор намерений

Логистическая регрессия (softmax) на хешированных признаках: слова, пары слов и буквенные n-граммы 2–4 (${DIM} корзин),
обучена на ${model.nTrain} фразах ${labels.length} намерений (ручные фразы и шаблоны с синонимами + опечатки, пропуски и перестановки букв, «а/слушай/подскажи», верхний регистр).
Веса квантованы в int8 и работают в телефоне тем же кодом (src/engine/intent.ts).

**Проверка на отложенных фразах** — каждая 4-я исходная фраза каждого намерения вместе со всеми её вариантами в обучение не попадала:

| Набор | Фраз | Точность |
|---|---|---|
| Отложенные с опечатками | ${testSet.length} | **${pc(model.acc)}** |
| Отложенные без изменений | ${bases.length} | ${pc(baseOk / bases.length)} |

${errs.length ? `Ошибки (первые ${errs.length}): ${errs.join('; ')}.` : 'Ошибок нет.'}

В приложении правила Пина срабатывают первыми; модель подключается, когда правила фразу не поняли, и только при уверенности ≥ 60%.
Пересчитать: \`npm run ml:intent\`.
<!-- intent:end -->`;
  const rep = readFileSync('ml/REPORT.md', 'utf8');
  writeFileSync('ml/REPORT.md', rep.includes('<!-- intent:start -->') ? rep.replace(/<!-- intent:start -->[\s\S]*<!-- intent:end -->/, md) : rep.trimEnd() + '\n\n' + md + '\n');
  console.log(md, '\nper-intent', JSON.stringify(per));
  expect(model.acc).toBeGreaterThan(0.7);
});
