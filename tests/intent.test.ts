// Модель намерений Пина: каждая каноническая фраза понятна правилам; фразы, которые правила не ловят,
// понимает модель («чё по каспи», «а без инета пашет?»); названия мест модель не перехватывает.
import { beforeAll, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { setCatalogReader, loadIndex, type CatalogIndex } from '../src/catalog/data';
import { talk, CANON, INTENT_MODEL } from '../src/engine/pinTalk';
import { classify } from '../src/engine/intent';
import { EMPTY_CTX } from '../src/engine/pinText';
import { useStore } from '../src/store';

let ix: CatalogIndex;
beforeAll(async () => { setCatalogReader(async (p) => JSON.parse(readFileSync(`public/catalog/${p}`, 'utf8'))); ix = await loadIndex(); useStore.getState().pinDemo(); });
const inp = (text: string, lastLot: string | null = null) => {
  const s = useStore.getState();
  return { text, ctx: EMPTY_CTX(), lastLot, ix, sim: { now: s.sim.now, origin: s.origin, occ: s.sim.occ, bookings: s.bookings, hist: s.sim.hist } };
};

test('модель обучена и точна на отложенных фразах', () => {
  expect(INTENT_MODEL.labels.length).toBeGreaterThan(20);
  expect(INTENT_MODEL.acc).toBeGreaterThan(0.85);
});

test('каждая каноническая фраза понятна правилам', () => {
  for (const [k, c] of Object.entries(CANON)) expect(talk(inp(c, ['price', 'cap', 'hours', 'book'].includes(k) ? 'op-front' : null)), `${k}: ${c}`).not.toBeNull();
});

test.each([
  ['чё по каспи', /Kaspi/],
  ['а без инета пашет?', /Без интернета/],
  ['ты чё такой тормоз', /досадно|понимаю/i],
  ['какие у тебя функции', /Подбираю парковку/],
])('«%s» — понимает модель', (q, re) => {
  const r = talk(inp(q));
  expect(r?.kind).toBe('say');
  if (r?.kind === 'say') expect(r.text).toMatch(re);
});

test('названия мест модель считает запросом места', () => {
  for (const q of ['хан шатыр', 'шугыла', 'dostyk plaza']) expect(classify(INTENT_MODEL, q)[0].label).toBe('query');
});

test('«чё по каспи» — вопрос про оплату даже до поиска места; места по-прежнему находятся', () => {
  const r = talk(inp('чё по каспи'), true);
  expect(r?.kind === 'say' && r.text).toMatch(/Kaspi/);
  for (const q of ['Хан Шатыр', 'Театр Абая через 10 минут', 'Шугыла', 'Dostyk Plaza на 2 часа', 'еду в мегу']) expect(talk(inp(q), true), q).toBeNull();
});
