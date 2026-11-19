// Микрорайоны и жилые массивы: «Шугыла», «Шұғыла», «мкр Орбита», «Аксай-4» — Пин находит их в Алматы.
import { beforeAll, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { setCatalogReader, loadIndex, loadPois, type CatalogIndex, type Poi } from '../src/catalog/data';
import { understand, EMPTY_CTX } from '../src/engine/pinText';

let ix: CatalogIndex, pois: Poi[];
beforeAll(async () => {
  setCatalogReader(async (p) => JSON.parse(readFileSync(`public/catalog/${p}`, 'utf8')));
  ix = await loadIndex(); pois = await loadPois();
});
const ALMATY = { lat: 43.238, lon: 76.912 }; // центр карты в демо
const where = (t: string, near: { lat: number; lon: number } | null = ALMATY) => {
  const u = understand(t, EMPTY_CTX(), ix, pois, near);
  const d = u.kind === 'query' ? u.ctx.place : null;
  return d ? { name: d.name, lat: d.lat, lon: d.lon } : { name: `(${u.kind})`, lat: 0, lon: 0 };
};
const inAlmaty = (p: { lat: number; lon: number }) => p.lat > 43.1 && p.lat < 43.4 && p.lon > 76.7 && p.lon < 77.1;

test.each([
  ['Шугыла', /Шугыла/],
  ['еду в шугылу', /Шугыла/],
  ['Шұғыла Алматы', /Шугыла|Шұғыла/],
  ['мкр Орбита', /Орбита/],
  ['Аксай-4', /Аксай-4/],
  ['Алмагуль', /Алмагуль/],
  ['Тау-Самал', /Тау.Самал/],
])('«%s» → микрорайон в Алматы', (q, re) => {
  const p = where(q);
  expect(p.name).toMatch(re);
  expect(inAlmaty(p)).toBe(true);
});

test('без карты рядом «Шугыла» — уточняющий вопрос с городами, Алматы среди вариантов', () => {
  const u = understand('Шугыла', EMPTY_CTX(), ix, pois, null);
  expect(u.kind).toBe('ask-place');
  if (u.kind === 'ask-place') expect(u.options.some((o) => inAlmaty(o.place))).toBe(true);
});
test('карта в Шымкенте — «Шугыла» в Шымкенте', () => {
  const p = where('Шугыла', { lat: 42.32, lon: 69.59 });
  expect(p.lat).toBeLessThan(42.6);
});
