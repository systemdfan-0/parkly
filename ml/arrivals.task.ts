// Помогает ли прогноз водителю? Метрика «доля приездов на полную парковку».
// На одних и тех же отложенных сценариях (тестовые дни синтетической истории, ml/scenarios.csv) сравниваем:
//   A. «Ближайшая, где сейчас есть места» — водитель смотрит только на текущие свободные места;
//   B. «Parkly» — recommend() приложения с ML-прогнозом к моменту приезда (тот же код, что в APK).
// Ограничения одинаковые: тот же радиус поиска, бюджет, только открытые к приезду парковки (закрытые и
// «временно закрыта» исключены у обоих; частных среди демо-парковок нет). Исход — показание датчика
// через 5/10/15 минут в той же симуляции: 0 свободных мест = «приехал на полную».
// Пишет раздел в ml/REPORT.md и ml/arrivals.json. Запуск: npm run ml:arrivals (после npm run ml:train).
import { expect, test } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { DESTINATIONS, LOT_BY_ID, ORIGINS, destToPlace } from '../src/data/places';
import { recommend, type Option } from '../src/engine/recommend';
import { parts } from '../src/engine/time';

interface Snap { fn: number; f5: number; f10: number; f15: number; t: Record<number, number> }
const H = [5, 10, 15] as const;
const BUDGETS: (number | null)[] = [null, 300];

const lines = readFileSync('ml/scenarios.csv', 'utf8').trim().split('\n').slice(1);
const byMs = new Map<number, Map<string, Snap>>();
for (const l of lines) {
  const [id, ms, fn, f5, f10, f15, p5, p10, p15] = l.split(',');
  if (!LOT_BY_ID[id]) continue;
  let m = byMs.get(+ms);
  if (!m) byMs.set(+ms, (m = new Map()));
  m.set(id, { fn: +fn, f5: +f5, f10: +f10, f15: +f15, t: { 5: +p5, 10: +p10, 15: +p15 } });
}

interface Acc { n: number; fullA: number; fullB: number; walkA: number; walkB: number; same: number; noneNow: number }
const acc = (): Acc => ({ n: 0, fullA: 0, fullB: 0, walkA: 0, walkB: 0, same: 0, noneNow: 0 });
const groups: Record<string, Record<string, Acc>> = { all: { all: acc() }, horizon: {}, time: {}, place: {}, budget: {}, tight: {} };
const add = (g: string, k: string, f: (a: Acc) => void) => f((groups[g][k] ??= acc()));
const band = (ms: number) => { const h = parts(ms).h; return h < 10 ? 'утро 7–10' : h < 17 ? 'день 10–17' : 'вечер 17–22'; };

test('доля приездов на полную: ближайшая с местами сейчас vs прогноз Parkly', () => {
  let skipped = 0;
  for (const [ms, snaps] of byMs) {
    // состояние «сейчас» и история 15 минут — как в приложении (занятость = вместимость − свободно)
    const occ: Record<string, number> = {}, hist: Record<string, number[]> = {};
    for (const [id, s] of snaps) {
      const c = LOT_BY_ID[id].capacity, o = (f: number) => c - f;
      occ[id] = o(s.fn);
      const pts = [o(s.f15), o(s.f10), o(s.f5), o(s.fn)];
      hist[id] = Array.from({ length: 16 }, (_, k) => { const i = Math.min(2, Math.floor(k / 5)), f = (k - i * 5) / 5; return Math.round(pts[i] + (pts[i + 1] - pts[i]) * f); });
    }
    for (const d of DESTINATIONS) {
      const place = destToPlace(d);
      for (const h of H) for (const budget of BUDGETS) {
        const r = recommend(place, ORIGINS[0], ms, 120, 'balanced', occ, [], { hist, arriveIn: h, budget });
        // те же ограничения для обоих: открыта к приезду, в бюджете, есть данные симуляции
        const av = r.options.filter((o) => o.available && snaps.has(o.lot.id));
        if (!av.length) { skipped++; continue; }
        const B = av[0];
        const near = [...av].sort((a, b) => a.walkM - b.walkM);
        const A: Option = near.find((o) => snaps.get(o.lot.id)!.fn >= 1) ?? near[0];
        const noneNow = !near.some((o) => snaps.get(o.lot.id)!.fn >= 1);
        const fullA = snaps.get(A.lot.id)!.t[h] === 0, fullB = snaps.get(B.lot.id)!.t[h] === 0;
        const put = (a: Acc) => { a.n++; a.fullA += +fullA; a.fullB += +fullB; a.walkA += A.walkMin; a.walkB += B.walkMin; a.same += +(A.lot.id === B.lot.id); a.noneNow += +noneNow; };
        put(groups.all.all);
        add('horizon', `+${h} мин`, put);
        add('time', band(ms), put);
        add('place', d.name, put);
        add('budget', budget == null ? 'без ограничения' : `до ${budget} ₸/ч`, put);
        const fA = snaps.get(A.lot.id)!.fn;
        add('tight', fA <= 3 ? 'у ближайшей сейчас 1–3 места (или ни одного)' : 'у ближайшей сейчас 4+ места', put);
      }
    }
  }

  const pc = (x: number, n: number) => `${((x / n) * 100).toFixed(1).replace('.', ',')}%`;
  const f1 = (x: number) => x.toFixed(1).replace('.', ',');
  const row = (k: string, a: Acc) =>
    `| ${k} | ${a.n} | ${pc(a.fullA, a.n)} | **${pc(a.fullB, a.n)}** | ${a.fullA - a.fullB >= 0 ? '−' : '+'}${f1(Math.abs((a.fullA - a.fullB) / a.n) * 100)} п.п. | ${f1(a.walkA / a.n)} | ${f1(a.walkB / a.n)} | ${pc(a.same, a.n)} |`;
  const head = '| Срез | Сценариев | На полную: ближайшая с местами | На полную: Parkly | Разница | Пешком, мин (A) | Пешком, мин (B) | Выбор совпал |\n|---|---|---|---|---|---|---|---|';
  const table = (g: string) => Object.entries(groups[g]).sort((a, b) => b[1].n - a[1].n).map(([k, a]) => row(k, a)).join('\n');
  const all = groups.all.all;
  const days = new Set([...byMs.keys()].map((ms) => { const p = parts(ms); return `${p.d}.${p.mo}`; })).size;

  // где Parkly помогает, а где нет — по местам
  const places = Object.entries(groups.place).map(([k, a]) => ({ k, d: (a.fullA - a.fullB) / a.n, dw: (a.walkB - a.walkA) / a.n }));
  const helps = places.filter((p) => p.d > 0.005).sort((a, b) => b.d - a.d);
  const flat = places.filter((p) => Math.abs(p.d) <= 0.005);
  const hurts = places.filter((p) => p.d < -0.005);

  const md = `<!-- arrivals:start -->
## Помогает ли прогноз водителю: доля приездов на полную парковку

> **Это симуляция**, а не замеры в городе: исходы взяты из той же синтетической истории (\`ml/train.py\`),
> на отложенных тестовых днях, которые модель не видела при обучении.

**Условия сравнения.** ${days} тестовых дней, каждые 10 минут с 7:00 до 22:00, ${DESTINATIONS.length} мест назначения демо Алматы,
приезд через 5, 10 и 15 минут, бюджет «без ограничения» и «до 300 ₸/ч». Всего **${all.n} сценариев**
(ещё ${skipped} пропущено: ни одной открытой парковки в бюджете). Для каждого сценария оба подхода выбирают из **одного
и того же** списка: парковки в радиусе поиска приложения, открытые к приезду и подходящие по бюджету
(«временно закрытые» исключены; частных среди демо-парковок нет).

- **A — «ближайшая, где сейчас есть места»**: самая близкая к входу парковка с ≥ 1 свободным местом по датчику сейчас
  (если мест нет нигде — просто ближайшая; таких сценариев ${pc(all.noneNow, all.n)}).
- **B — Parkly**: первый вариант \`recommend()\` приложения — ML-прогноз к приезду, время пешком, цена.
- **Исход**: показание датчика на выбранной парковке в момент приезда; 0 мест = «приехал на полную».

| Срез | Сценариев | На полную: A | На полную: B (Parkly) | Разница | Пешком, мин (A) | Пешком, мин (B) | Выбор совпал |
|---|---|---|---|---|---|---|---|
${row('Все сценарии', all)}

**По горизонту приезда**

${head}
${table('horizon')}

**По времени суток**

${head}
${table('time')}

**Когда у ближайшей парковки сейчас мало мест**

${head}
${table('tight')}

**По бюджету**

${head}
${table('budget')}

**По местам назначения**

${head}
${table('place')}

**Вывод по этому прогону.** В целом Parkly снижает долю приездов на полную с ${pc(all.fullA, all.n)} до ${pc(all.fullB, all.n)}
ценой ${f1((all.walkB - all.walkA) / all.n)} мин пешком в среднем. Выбор совпадает с «ближайшей с местами» в ${pc(all.same, all.n)} сценариев —
там разницы нет по определению.
${helps.length ? `Заметнее всего помогает у: ${helps.slice(0, 5).map((p) => `${p.k} (−${f1(p.d * 100)} п.п., +${f1(p.dw)} мин пешком)`).join(', ')}.` : 'Заметного выигрыша ни у одного места нет.'}
${flat.length ? `Почти без разницы (±0,5 п.п.): ${flat.map((p) => p.k).join(', ')} — там мест хватает или вариант один.` : ''}
Цена в ходьбе неравномерна: больше всего лишних минут пешком у ${[...places].sort((a, b) => b.dw - a.dw).slice(0, 3).map((p) => `${p.k} (+${f1(p.dw)} мин)`).join(', ')}.
${hurts.length ? `Хуже, чем «ближайшая с местами»: ${hurts.map((p) => `${p.k} (+${f1(-p.d * 100)} п.п.)`).join(', ')}.` : 'Ни у одного места Parkly не оказался хуже по доле приездов на полную.'}

Пересчитать: \`npm run ml:train && npm run ml:arrivals\`. Сырые числа — \`ml/arrivals.json\`.
<!-- arrivals:end -->`;

  const rep = readFileSync('ml/REPORT.md', 'utf8');
  const out = rep.includes('<!-- arrivals:start -->')
    ? rep.replace(/<!-- arrivals:start -->[\s\S]*<!-- arrivals:end -->/, md)
    : rep.trimEnd() + '\n\n' + md + '\n';
  writeFileSync('ml/REPORT.md', out);
  writeFileSync('ml/arrivals.json', JSON.stringify({ scenarios: all.n, skipped, days, groups }, null, 1) + '\n');
  console.log(md);
  expect(all.n).toBeGreaterThan(1000);
});
