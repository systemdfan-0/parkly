// Подбор в каталоге в трудных случаях: рядом только частные, дороже бюджета, без цены, расширение радиуса.
// Каталог — маленький искусственный (вокруг точки 50.0, 70.0), чтобы условия были точно известны.
import { describe, expect, test, beforeEach } from 'vitest';
import { setCatalogReader } from '../src/catalog/data';
import { catalogFor } from '../src/catalog/rank';
import { pinReply, type SimInput } from '../src/engine/pinReply';
import { EMPTY_CTX } from '../src/engine/pinText';
import type { Place } from '../src/data/places';

const P: Place = { id: 'test:place', name: 'Тестовое место', address: '', lat: 50, lon: 70, kind: 'landmark' };
const north = (m: number) => 50 + m / 111_320;
type Lot = [string, number, number, string, string, string | null, number | null, 0 | 1 | null, string | null, string, string, string, number, number];
const lot = (id: string, m: number, fee: 0 | 1 | null, access: string | null, charge = ''): Lot => [id, north(m), 70, '', '', 'surface', null, fee, access, '', '', charge, 0, -1];

function useLots(lots: Lot[]) {
  setCatalogReader(async (p) => {
    if (p === 'index.json') return { source: {}, cellSize: 0.25, stats: {}, regions: [], cities: [], cells: [['200_280', lots.length, 50, 70]] };
    if (p === 'cells/200_280.json') return lots;
    throw new Error(p);
  });
}
const sim = { now: 0, origin: P, occ: {}, bookings: [], hist: {} } as unknown as SimInput;
const ask = (budget: number | null) => pinReply(EMPTY_CTX({ place: P, budget }), sim, null);

describe('каталог: трудные случаи', () => {
  beforeEach(() => useLots([
    lot('w1', 150, null, 'private'),            // частная, ближе всех
    lot('w2', 300, 1, 'public', '500 тг/час'),   // платная, 500 ₸/ч
    lot('w3', 450, null, null),                  // цена не указана
    lot('w4', 1200, 0, 'public'),                // бесплатная, но далеко
  ]));

  test('без бюджета: советует открытую, частную показывает отдельно', async () => {
    const r = await catalogFor(P, 'balanced', null);
    expect(r.expanded).toBeUndefined();
    expect(r.options[0].lot.osm).not.toBe('w1');
    expect(r.privateNear.map((o) => o.lot.osm)).toEqual(['w1']);
    const a = await ask(null);
    expect(a.details!.join(' ')).toMatch(/частные ближе.*пропуск/);
  });

  test('бюджет 300 ₸: в 800 м подходящих нет → поиск расширен до 1,5 км и об этом сказано', async () => {
    const r = await catalogFor(P, 'balanced', 300);
    expect(r.radius).toBe(1500);
    expect(r.expanded?.from).toBe(800);
    expect(r.options[0].lot.osm).toBe('w4');
    const a = await ask(300);
    expect(a.text).toMatch(/в 800 м .*искал до 1,5 км/);
    expect(a.show!.lotId).toBe('osm:w4');
  });

  test('рядом только частные: так и говорит, нужен пропуск', async () => {
    useLots([lot('w1', 150, null, 'private'), lot('w5', 400, null, 'private')]);
    const a = await ask(null);
    expect(a.text).toMatch(/только частные парковки \(2\) — нужен пропуск/);
    expect(a.text).toMatch(/до|в 3 км|3,0 км/);
  });

  test('все дороже бюджета или без цены даже в 3 км: предлагает снять ограничение', async () => {
    useLots([lot('w2', 300, 1, 'public', '500 тг/час'), lot('w3', 450, null, null)]);
    const a = await ask(200);
    expect(a.text).toMatch(/Не могу обещать парковку до 200 ₸ в час/);
    expect(a.text).toMatch(/Искал до 3/);
    expect(a.actions?.[0].label).toBe('Без ограничения по цене');
  });
});
