import { describe, expect, test, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { setCatalogReader, loadIndex, loadPois, catalogNear } from '../src/catalog/data';
import { usePin } from '../src/pinStore';
import { useMap } from '../src/mapState';
import { useStore } from '../src/store';
import { LOTS, DESTINATIONS, DEMO_OSM } from '../src/data/places';
import anchors from '../src/data/anchors.json';

const sentences = (t: string) => t.replace(/(^|\s)(ул|пр|мкр|им|г|д)\.\s/g, '$1$2_ ').split(/(?<=[.!?])\s+(?=[А-ЯЁA-Z«])/).length;
const last = () => usePin.getState().msgs.at(-1)!;
async function ask(text: string) { await usePin.getState().send(text); return last(); }

beforeAll(async () => {
  setCatalogReader(async (p) => JSON.parse(readFileSync(`public/catalog/${p}`, 'utf8')));
  await loadIndex(); await loadPois();
  useStore.getState().pinDemo();
});
beforeEach(() => { usePin.getState().reset(); useMap.setState({ geo: { status: 'idle' }, view: null }); });

describe('демо-парковки стоят на реальных объектах OSM', () => {
  test('у каждой демо-парковки и ориентира есть привязка', () => {
    const a = (anchors as { anchors: Record<string, unknown[]> }).anchors;
    for (const l of LOTS) expect(a[l.id], l.id).toBeTruthy();
    for (const d of DESTINATIONS) expect(a[d.id], d.id).toBeTruthy();
    expect(DEMO_OSM.size).toBeGreaterThan(25);
  });
  test('парковка привязана к настоящей amenity=parking из каталога (те же координаты)', async () => {
    const lot = LOTS.find((l) => l.id === 'dp-under')!;
    expect(lot.osm).toBeTruthy();
    const near = await catalogNear(lot.lat, lot.lon, 30);
    expect(near.some((c) => c.osm === lot.osm)).toBe(true);
  });
  test('демо-парковка не дальше разумного от своего ориентира', () => {
    const dp = DESTINATIONS.find((d) => d.id === 'dostyk-plaza')!;
    for (const l of LOTS.filter((x) => x.id.startsWith('dp-'))) {
      const d = Math.hypot((l.lat - dp.lat) * 111320, (l.lon - dp.lon) * 111320 * Math.cos(dp.lat * Math.PI / 180));
      expect(d, l.id).toBeLessThan(800);
    }
  });
});

describe('Пин: вопросы не про подбор', () => {
  test('приветствие и «что умеешь» — коротко и с подсказками', async () => {
    const a = await ask('Привет');
    expect(a.text).toMatch(/Куда едем/);
    expect(a.suggest?.length).toBeGreaterThan(0);
    const b = await ask('что ты умеешь?');
    expect(b.text).toMatch(/Подбираю парковку/);
    expect(sentences(b.text)).toBeLessThanOrEqual(2);
  });

  test('«куда» не принимается за приветствие «ку», «покажи» — за «пока»', async () => {
    const a = await ask('куда встать у Хан Шатыра');
    expect(a.reply?.show).toBeTruthy();
    const b = await ask('покажи Dostyk Plaza');
    expect(b.reply?.show).toBeTruthy();
  });

  test('вопросы про парковку из прошлого ответа: цена, места, часы, бронь', async () => {
    await ask('Dostyk Plaza через 15 минут');
    const lot = usePin.getState().lastLot!;
    expect(lot).toBeTruthy();
    const price = await ask('а сколько стоит?');
    expect(price.text).toMatch(/₸|бесплатно/);
    expect(price.text).toMatch(/демо/);
    expect(price.reply?.show?.lotId).toBe(lot);
    const cap = await ask('а сколько там мест?');
    expect(cap.text).toMatch(/свободно сейчас|закрыта/);
    const book = await ask('можно забронировать?');
    expect(book.text).toMatch(/брон/i);
    for (const m of [price, cap, book]) expect(sentences(m.text)).toBeLessThanOrEqual(2);
  });

  test('про парковку из каталога: неизвестное честно «нет данных»', async () => {
    await ask('Хан Шатыр');
    expect(usePin.getState().lastLot).toMatch(/^osm:/);
    const h = await ask('она круглосуточная?');
    expect(h.text).toMatch(/OSM|нет данных/);
    const c = await ask('сколько свободных мест?');
    expect(c.text).toMatch(/занятость — нет данных/);
  });

  test('без прошлого ответа просит назвать место', async () => {
    const a = await ask('сколько стоит?');
    expect(a.text).toMatch(/куда едете/);
  });

  test('покрытие и источник — из индекса каталога', async () => {
    const a = await ask('сколько парковок в Астане?');
    expect(a.text).toMatch(/Астана 1\s?\d{3}/);
    const b = await ask('откуда данные?');
    expect(b.text).toMatch(/OpenStreetMap/);
    const c = await ask('в каких городах больше всего парковок');
    expect(c.text).toMatch(/Алматы/);
  });

  test('рядом со мной — по геопозиции', async () => {
    useMap.setState({ geo: { status: 'ok', lat: 51.0889, lon: 71.4161 } }); // Астана, у Хан Шатыра
    const a = await ask('где припарковаться рядом со мной?');
    expect(a.reply?.show).toBeTruthy();
    expect(a.text).toMatch(/Ближе всего/);
  });

  test('рядом со мной без геопозиции и без карты — объясняет, что делать', async () => {
    useMap.setState({ geo: { status: 'denied' } });
    const a = await ask('рядом со мной');
    expect(a.text).toMatch(/геолокац/i);
  });

  test('не по теме и грубость — спокойно, без выдумок', async () => {
    const a = await ask('какая завтра погода?');
    expect(a.text).toMatch(/только данные о парковках/);
    const b = await ask('ты тупой');
    expect(b.text).toMatch(/место, время и бюджет/);
    const c = await ask('расскажи анекдот');
    expect(sentences(c.text)).toBeLessThanOrEqual(2);
  });

  test('короткие «спасибо», «рахмет», «сәлем» — не города и не кафе; «помоги найти…» — подбор', async () => {
    expect((await ask('спасибо')).text).toMatch(/Пожалуйста/);
    expect((await ask('рахмет')).text).toMatch(/Пожалуйста/);
    expect((await ask('сәлем')).text).toMatch(/Привет/);
    expect((await ask('помоги найти парковку у Меги в Алматы')).reply?.show).toBeTruthy();
    expect((await ask('как отменить бронь')).text).toMatch(/Поездки/);
    expect((await ask('что значат цвета меток')).text).toMatch(/цветная точка/);
  });

  test('штрафы — не гадает', async () => {
    const a = await ask('какой штраф за парковку на газоне?');
    expect(a.text).toMatch(/не буду гадать/);
  });

  test('непонятное — подсказка, а не тишина', async () => {
    const a = await ask('фываолдж');
    expect(a.text).toMatch(/Не нашёл/);
    expect(a.suggest).toContain('Что ты умеешь?');
  });

  test('подбор по-прежнему работает с уточнениями', async () => {
    await ask('Dostyk Plaza через 15 минут');
    const a = await ask('а поближе?');
    expect(a.reply?.show).toBeTruthy();
    const b = await ask('тогда до 700');
    expect(b.reply).toBeTruthy();
  });
});
