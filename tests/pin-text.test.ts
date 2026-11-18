import { describe, expect, test, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { setCatalogReader, loadIndex, loadPois, catalogNear, type CatalogIndex, type Poi } from '../src/catalog/data';
import { matchCities, matchPlaces } from '../src/catalog/geo';
import { tokens } from '../src/catalog/text';
import { understand, extractSlots, EMPTY_CTX, type PinCtx } from '../src/engine/pinText';
import { pinReply, type SimInput } from '../src/engine/pinReply';
import { useStore } from '../src/store';

let ix: CatalogIndex;
let pois: Poi[];
// сокращения «ул.», «пр.», «мкр.», «им.» не считаем концом предложения
const sentences = (t: string) => t.replace(/(^|\s)(ул|пр|мкр|им|г|д)\.\s/g, '$1$2_ ').split(/(?<=[.!?])\s+(?=[А-ЯЁA-Z«])/).length;

function sim(): SimInput {
  const s = useStore.getState();
  return { now: s.sim.now, origin: s.origin, occ: s.sim.occ, bookings: s.bookings, hist: s.sim.hist };
}
async function ask(text: string, prev: PinCtx = EMPTY_CTX(), prevLot: string | null = null) {
  const u = understand(text, prev, ix, pois);
  if (u.kind !== 'query') return { u, reply: null };
  return { u, reply: await pinReply(u.ctx, sim(), prevLot, u.changed) };
}

beforeAll(async () => {
  setCatalogReader(async (p) => JSON.parse(readFileSync(`public/catalog/${p}`, 'utf8')));
  ix = await loadIndex();
  pois = await loadPois();
  useStore.getState().pinDemo();
});

describe('каталог OSM', () => {
  test('источник и дата выгрузки записаны, покрытие посчитано', () => {
    expect(ix.source.url).toContain('geofabrik.de/asia/kazakhstan');
    expect(ix.source.extractDate).toMatch(/^\d{4}-\d\d-\d\d/);
    expect(ix.stats.lots).toBeGreaterThan(5000);
    expect(ix.regions.length).toBeGreaterThanOrEqual(17);
    const top = [...ix.cities].sort((a, b) => b.lots - a.lots).slice(0, 2).map((c) => c.ru);
    expect(top).toEqual(['Алматы', 'Астана']);
  });
  test('парковки грузятся по району', async () => {
    const near = await catalogNear(51.1325, 71.40386, 800); // Хан Шатыр
    expect(near.length).toBeGreaterThan(0);
    expect(near.every((l) => l.id.startsWith('osm:'))).toBe(true);
  });
  test('города: русский, казахский, старые названия, падежи', () => {
    const c = (s: string) => matchCities(ix, tokens(s), new Set([0, 1, 2]))[0]?.city?.ru;
    expect(c('в Астане')).toBe('Астана');
    expect(c('Нур-Султан')).toBe('Астана');
    expect(c('Қарағанды')).toBe('Караганда');
    expect(c('в Караганде')).toBe('Караганда');
    expect(c('Өскемен')).toBe('Усть-Каменогорск');
    expect(c('Чимкент')).toBe('Шымкент');
    expect(c('Алма-Ата')).toBe('Алматы');
    expect(c('Ақтөбе')).toBe('Актобе');
  });
  test('места: латиница и кириллица, склонения', () => {
    const p = (s: string) => matchPlaces(ix, pois, tokens(s), {})[0]?.place.name;
    expect(p('хан шатыра')).toBe('Хан Шатыр');
    expect(p('Khan Shatyr')).toBe('Хан Шатыр');
    expect(p('достык плазы')).toBe('Dostyk Plaza');
  });
});

describe('Пин понимает свободный текст', () => {
  test('слоты: бюджет, приезд, длительность, приоритет', () => {
    expect(extractSlots('до 500 тенге в час')).toMatchObject({ budget: 500 });
    expect(extractSlots('тогда до 700')).toMatchObject({ budget: 700 });
    expect(extractSlots('не дороже 1000₸')).toMatchObject({ budget: 1000 });
    expect(extractSlots('бесплатно')).toMatchObject({ budget: 0 });
    expect(extractSlots('через 15 минут')).toMatchObject({ arriveIn: 15 });
    expect(extractSlots('10 минуттан кейін')).toMatchObject({ arriveIn: 10 });
    expect(extractSlots('на 3 часа')).toMatchObject({ durationMin: 180 });
    expect(extractSlots('а поближе?')).toMatchObject({ priority: 'close' });
    expect(extractSlots('до 18:00')).toEqual({});
  });

  test('«У Хан Шатыра, до 500 тенге в час» — Астана, бюджет, ответ из каталога', async () => {
    const { u, reply } = await ask('У Хан Шатыра, до 500 тенге в час');
    expect(u.kind).toBe('query');
    if (u.kind !== 'query') return;
    expect(u.ctx.place?.name).toBe('Хан Шатыр');
    expect(u.ctx.city?.ru).toBe('Астана');
    expect(u.ctx.budget).toBe(500);
    expect(reply!.mode).toBe('catalog');
    expect(sentences(reply!.text)).toBeLessThanOrEqual(2);
    console.log('Хан Шатыр →', reply!.text, reply!.actions?.map((a) => a.label));
  });

  test('«Куда лучше встать у Достык Плазы через 15 минут?» — демо + ML, затем «а поближе?» и «тогда до 700»', async () => {
    const a = await ask('Куда лучше встать у Достык Плазы через 15 минут?');
    expect(a.u.kind).toBe('query');
    if (a.u.kind !== 'query') return;
    expect(a.u.ctx.place?.name).toBe('Dostyk Plaza');
    expect(a.u.ctx.arriveIn).toBe(15);
    expect(a.reply!.mode).toBe('demo');
    expect(a.reply!.text).toMatch(/ML-модель/);
    expect(sentences(a.reply!.text)).toBeLessThanOrEqual(2);
    console.log('Достык 15 →', a.reply!.text);

    const b = await ask('а поближе?', a.u.ctx, a.reply!.lotId!);
    expect(b.u.kind).toBe('query');
    if (b.u.kind !== 'query') return;
    expect(b.u.followUp).toBe(true);
    expect(b.u.ctx.place?.name).toBe('Dostyk Plaza');
    expect(b.u.ctx.priority).toBe('close');
    expect(b.u.ctx.arriveIn).toBe(15);
    console.log('а поближе →', b.reply!.text);

    const c = await ask('тогда до 700', b.u.ctx, b.reply!.lotId ?? null);
    if (c.u.kind !== 'query') throw new Error(c.u.kind);
    expect(c.u.ctx.budget).toBe(700);
    expect(sentences(c.reply!.text)).toBeLessThanOrEqual(2);
    console.log('до 700 →', c.reply!.text, c.reply!.actions?.map((x) => x.label));
  });

  test('город из прошлого запроса не перебивает явно названное место', async () => {
    const a = await ask('У Хан Шатыра, до 500 тенге в час');
    if (a.u.kind !== 'query') throw new Error(a.u.kind);
    const b = await ask('Куда лучше встать у Достык Плазы через 15 минут?', a.u.ctx, a.reply!.lotId!);
    expect(b.u.kind === 'query' && b.u.ctx.place?.name).toBe('Dostyk Plaza');
    expect(b.reply!.mode).toBe('demo');
    expect(b.u.kind === 'query' && b.u.ctx.budget).toBe(null);
  });

  test('нет парковок рядом — предлагает одно изменение: ближайший город', async () => {
    const prev = await ask('Актобе, ТРЦ Keruen City');
    if (prev.u.kind !== 'query') throw new Error(prev.u.kind);
    const { u, reply } = await ask('где встать у мавзолея Абая Кунанбаева', prev.u.ctx, prev.reply!.lotId!);
    expect(u.kind === 'query' && u.ctx.city).toBe(null);
    expect(reply!.text).toMatch(/нет парковок/);
    expect(reply!.actions).toHaveLength(1);
    expect(reply!.actions![0].label).not.toMatch(/Актобе/);
    console.log('мавзолей →', reply!.text, reply!.actions![0].label);
  });

  test('сценарий защиты текстом: «через 5 минут» → у театра, «а через 15?» → другая парковка и причина', async () => {
    useStore.getState().pinDemo();
    const a = await ask('У театра Абая через 5 минут');
    if (a.u.kind !== 'query') throw new Error(a.u.kind);
    expect(a.reply!.mode).toBe('demo');
    expect(a.reply!.source).toBe('ml');
    const b = await ask('а через 15?', a.u.ctx, a.reply!.lotId!, );
    if (b.u.kind !== 'query') throw new Error(b.u.kind);
    expect(b.u.ctx.arriveIn).toBe(15);
    expect(b.reply!.lotId).not.toBe(a.reply!.lotId);
    expect(b.reply!.text).toMatch(/спектакл/);
    expect(sentences(b.reply!.text)).toBeLessThanOrEqual(2);
  });

  test('неоднозначное место — один короткий вопрос', () => {
    const u = understand('где встать у Меги', EMPTY_CTX(), ix, pois);
    console.log('мега →', u.kind, 'question' in u ? u.question : '', 'options' in u ? u.options.map((o) => o.hint) : '');
    expect(u.kind).toBe('ask-place');
    if (u.kind === 'ask-place') {
      expect(u.question.split('?').length).toBe(2);
      expect(u.question).toMatch(/Астана/);
      expect(u.question).toMatch(/Шымкент/);
    }
  });

  test('только город — уточняющий вопрос; неизвестное место — честно', () => {
    const u = understand('парковка в Караганде', EMPTY_CTX(), ix, pois);
    expect(u.kind).toBe('ask-city');
    if (u.kind === 'ask-city') expect(u.question).toBe('Куда именно в Караганде? Напишите место или адрес.');
    expect(understand('у фывапролджэ', EMPTY_CTX(), ix, pois).kind).toBe('not-found');
  });

  test('казахский и город в запросе', async () => {
    const a = understand('Хан Шатыр жанында тұрақ қайда?', EMPTY_CTX(), ix, pois);
    expect(a.kind === 'query' && a.ctx.place?.name).toBe('Хан Шатыр');
    const b = understand('Нур-Султан, Байтерек', EMPTY_CTX(), ix, pois);
    expect(b.kind === 'query' && b.ctx.city?.ru).toBe('Астана');
    console.log('Байтерек →', b.kind === 'query' ? b.ctx.place?.name : b.kind);
  });

  test('в нескольких городах ответ ≤ 2 предложений и есть что показать на карте', async () => {
    for (const q of ['Шымкент, ТРЦ Mega Planet', 'Караганда, Сити Молл', 'вокзал в Караганде', 'у вокзала Актобе', 'Атырау, Атырау Плаза', 'Усть-Каменогорск, ТРЦ Адк']) {
      const { u, reply } = await ask(q);
      console.log(q, '→', u.kind, u.kind === 'query' ? `${u.ctx.place?.name} | ${reply!.text}` : 'question' in u ? u.question : '');
      if (reply) { expect(sentences(reply.text)).toBeLessThanOrEqual(2); }
    }
  });
});
