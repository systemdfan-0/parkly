// Сравнение на одних и тех же тестовых днях (последние 7 дней синтетической истории):
// дерево решений, запущенное ИЗ TypeScript (как в APK), против эвристики приложения (forecast из model.ts).
// Пишет ml/REPORT.md. Запуск: npm run ml (или npm run ml:compare после ml/train.py).
import { expect, test } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { LOT_BY_ID } from '../src/data/places';
import { forecast } from '../src/engine/model';
import { predictAt } from '../src/ml/predict';
import { fmtDate } from '../src/engine/time';

interface Row { lot: string; ms: number; now: number; m5: number; m10: number; m15: number; h: number; target: number; py: number }

test('дерево vs эвристика на тестовых днях', () => {
  const lines = readFileSync('ml/test_days.csv', 'utf8').trim().split('\n').slice(1);
  const rows: Row[] = lines.map((l) => {
    const [lot, ms, now, m5, m10, m15, h, target, py] = l.split(',');
    return { lot, ms: +ms, now: +now, m5: +m5, m10: +m10, m15: +m15, h: +h, target: +target, py: +py };
  });
  const train = JSON.parse(readFileSync('ml/train_metrics.json', 'utf8'));
  const by: Record<number, { n: number; tree: number; heur: number; pers: number; mism: number; treeRel: number; heurRel: number; inT: number; inH: number }> = {};
  for (const r of rows) {
    const lot = LOT_BY_ID[r.lot];
    const ml = predictAt(lot, r.ms, { now: r.now, m5: r.m5, m10: r.m10, m15: r.m15 }, r.h).band;
    // эвристика получает те же сведения о текущем состоянии: занятость = вместимость − свободно сейчас
    const he = forecast(lot, lot.capacity - r.now, r.ms, r.h, [], { runs: 60 });
    const s = (by[r.h] ??= { n: 0, tree: 0, heur: 0, pers: 0, mism: 0, treeRel: 0, heurRel: 0, inT: 0, inH: 0 });
    s.n++;
    s.tree += Math.abs(ml.mid - r.target);
    s.heur += Math.abs(he.mid - r.target);
    s.pers += Math.abs(r.now - r.target);
    s.treeRel += Math.abs(ml.mid - r.target) / lot.capacity;
    s.heurRel += Math.abs(he.mid - r.target) / lot.capacity;
    if (r.target >= ml.lo && r.target <= ml.hi) s.inT++;
    if (r.target >= he.lo && r.target <= he.hi) s.inH++;
    if (ml.mid !== r.py) s.mism++;
  }
  const first = Math.min(...rows.map((r) => r.ms)), last = Math.max(...rows.map((r) => r.ms));
  const f = (x: number) => x.toFixed(2).replace('.', ',');
  const p = (x: number) => `${Math.round(x * 100)}%`;
  const table = Object.entries(by).map(([h, s]) =>
    `| +${h} мин | ${s.n} | **${f(s.tree / s.n)}** | ${f(s.heur / s.n)} | ${f(s.pers / s.n)} | ${f((s.treeRel / s.n) * 100)}% / ${f((s.heurRel / s.n) * 100)}% | ${p(s.inT / s.n)} / ${p(s.inH / s.n)} |`).join('\n');
  const md = `# Офлайн ML-прогноз Parkly: результаты

> **Происхождение данных: синтетика.** Реальных замеров с датчиков нет. История сгенерирована скриптом
> \`ml/train.py\` (seed ${JSON.parse(readFileSync('src/ml/model.json', 'utf8')).seed}): 4 недели поминутно, ${Object.keys(LOT_BY_ID).length - 1} демо-парковок,
> свои пики у каждой парковки, дождливые дни (${train.rain_days.length} из ${train.days}), пятничный вечер, киносеансы, события на стадионе,
> перекрытия въезда, ошибка датчика ±1. Эвристика приложения этих особенностей не знает.

Разбиение по целым дням: обучение — дни 1–${train.train_days}, проверка — дни ${train.train_days + 1}–${train.days}
(${fmtDate(first)} — ${fmtDate(last)} по календарю демо-истории). Признаки — только прошлое и текущий момент.
Для сравнения взят каждый третий тестовый пример (${rows.length} прогнозов).

| Горизонт | Примеров | MAE дерева, мест | MAE эвристики, мест | MAE «останется как сейчас» | Ошибка в % вместимости (дерево / эвристика) | Факт в диапазоне 20–80% (дерево / эвристика) |
|---|---|---|---|---|---|---|
${table}

- Дерево считается в TypeScript тем же кодом, что работает в APK (\`src/ml/predict.ts\`); расхождение с Python
  (точечный прогноз): ${Object.values(by).reduce((a, s) => a + s.mism, 0)} из ${rows.length}.
- Эвристика — функция \`forecast\` приложения (модель потоков, 60 прогонов Монте-Карло), медиана.
- Обучение: \`DecisionTreeRegressor(max_depth=8, min_samples_leaf=300)\`, CPU, ${train.seconds} с, Python ${train.python}.
  Примеров: обучение ${train.train}, проверка ${train.test}.
- Самые важные признаки (+15 мин): ${train.metrics['15'].top_features.map((x: [string, number]) => `${x[0]} ${x[1]}`).join(', ')}.

В приложении дерево используется для горизонтов до 15 минут (между 5, 10 и 15 — линейная интерполяция).
Если до приезда больше 15 минут, работает эвристика, и карточка подписывает это: «прогноз: эвристика».
`;
  // раздел про «приезды на полную» (ml/arrivals.task.ts) сохраняем
  const old = (() => { try { return readFileSync('ml/REPORT.md', 'utf8'); } catch { return ''; } })();
  const keep = old.match(/<!-- arrivals:start -->[\s\S]*<!-- arrivals:end -->/)?.[0];
  writeFileSync('ml/REPORT.md', keep ? md.trimEnd() + '\n\n' + keep + '\n' : md);
  for (const s of Object.values(by)) expect(s.mism / s.n).toBeLessThan(0.002);
});
