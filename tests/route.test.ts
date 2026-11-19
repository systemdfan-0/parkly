// Маршруты: разбор ответа 2ГИС (настоящий ответ Routing API, сохранён без ключа), запасная прямая, ключ только UUID.
import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse2gis, parseLine, lineRoute, jamShare, set2gisKey, get2gisKey, fmtDur } from '../src/route/route';

test('LINESTRING → [lat, lon]', () => {
  expect(parseLine('LINESTRING(76.906112 43.237925, 76.906137 43.237737)')).toEqual([[43.237925, 76.906112], [43.237737, 76.906137]]);
});

test('ответ 2ГИС: участки по улицам с загруженностью, время и длина', () => {
  const r = parse2gis(JSON.parse(readFileSync('tests/fixtures/2gis-car-route.json', 'utf8')), 'car')!;
  expect(r.source).toBe('2gis');
  expect(r.distM).toBeGreaterThan(3000);
  expect(r.durS).toBeGreaterThan(300);
  expect(r.segs.length).toBeGreaterThan(5);
  const pts = r.segs.flatMap((s) => s.pts);
  expect(pts.length).toBeGreaterThan(20); // не прямая из двух точек
  for (const [la, lo] of pts) { expect(la).toBeGreaterThan(43.2); expect(lo).toBeGreaterThan(76.8); }
  expect(r.segs.some((s) => s.jam === 'fast')).toBe(true);
  const sh = jamShare(r);
  expect(sh.fast + sh.normal + sh.slow + sh.jam).toBeGreaterThan(0.5);
});

test('без сети — прямая с запасом на повороты', () => {
  const w = lineRoute('walk', { lat: 43.2365, lon: 76.9455 }, { lat: 43.2399, lon: 76.9455 });
  expect(w.source).toBe('line');
  expect(w.distM).toBeGreaterThan(378 * 1.25);
  expect(Math.round(w.durS / 60)).toBeGreaterThanOrEqual(6);
});

test('ключ 2ГИС: только формат UUID, хранится локально, удаляется', () => {
  expect(set2gisKey('не ключ')).toBe(false);
  expect(get2gisKey()).toBeNull();
  expect(set2gisKey('00000000-0000-4000-8000-000000000000')).toBe(true);
  expect(get2gisKey()).toBe('00000000-0000-4000-8000-000000000000');
  set2gisKey(null);
  expect(get2gisKey()).toBeNull();
  expect(fmtDur(61 * 60)).toBe('1 ч 1 мин');
});
