// «Почему ИИ так решил»: объяснение идёт по тому же листу, что и прогноз, и говорит человеческим языком.
import { expect, test } from 'vitest';
import { LOT_BY_ID } from '../src/data/places';
import { explainAt, predictAt } from '../src/ml/predict';
import { almatyMs } from '../src/engine/time';

test('путь в дереве: условия по-русски, изменение = среднее листа', () => {
  const lot = LOT_BY_ID['op-front'];
  const ms = almatyMs(2026, 10, 19, 18, 25);
  const r = { now: 6, m5: 8, m10: 11, m15: 14 };
  const e = explainAt(lot, ms, r, 15);
  expect(e.depth).toBeGreaterThan(3);
  expect(e.steps.length).toBeGreaterThanOrEqual(2);
  expect(e.steps.some((s) => s.text.startsWith("не "))).toBe(false);
  expect(e.steps.map((s) => s.text).join(' ')).toMatch(/время|свободно|за \d+ мин|тип/);
  const p = predictAt(lot, ms, r, 15);
  expect(Math.abs(r.now + e.delta - p.mean)).toBeLessThan(1.01); // тот же лист
});
