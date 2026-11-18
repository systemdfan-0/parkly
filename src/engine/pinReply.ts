// Ответ Пина: не больше двух предложений, только факты из расчётов.
// Демо-парковки Алматы — recommend() с ML-прогнозом на 5–15 мин; остальная страна — каталог OSM
// (там нет занятости и почти нет цен, это говорим прямо).
import type { Place } from '../data/places';
import type { Booking } from './model';
import { recommend, rangeText, type Option, type Result } from './recommend';
import { tenge } from './pricing';
import { fmtTime, fmtDur } from './time';
import { spotsWord } from '../format';
import { fmtDist } from './geo';
import { catalogFor, feeText, type CatOption, type CatResult } from '../catalog/rank';
import { distM, indexSync } from '../catalog/data';
import type { PinCtx } from './pinText';

export interface PinAction { label: string; patch?: Partial<PinCtx>; place?: Place; city?: PinCtx['city'] }
export interface PinReply {
  text: string;
  mode: 'demo' | 'catalog' | 'none';
  /** Что показать на карте по кнопке «Показать на карте». */
  show?: { lotId: string; place: Place };
  /** Одно предложенное изменение условия или варианты для уточнения. */
  actions?: PinAction[];
  source?: 'ml' | 'heuristic' | 'osm';
  lotId?: string;
}

export interface SimInput {
  now: number; origin: Place; occ: Record<string, number>; bookings: Booking[]; hist: Record<string, number[]>;
}

const pct = (p: number) => `${Math.round(p * 100)}%`;
const priceShort = (o: Option) => (o.price.total ? `${tenge(o.price.total)} за ${fmtDur(o.durationMin)}` : 'бесплатно');
const fcShort = (o: Option) => `к ${fmtTime(o.eta)} ${rangeText(o.fc)} ${spotsWord(o.fc.hi)}`;
const perHour = (o: Option) => (o.durationMin ? Math.round(o.price.total / (o.durationMin / 60)) : 0);
const roundUp50 = (v: number) => Math.ceil(v / 50) * 50;
const budgetPhrase = (b: number) => (b === 0 ? 'бесплатных' : `до ${tenge(b)} в час`);

/** Демо-режим: есть ли симулированные парковки у этого места. */
export function demoResult(ctx: PinCtx, sim: SimInput): Result | null {
  if (!ctx.place) return null;
  const r = recommend(ctx.place, sim.origin, sim.now, ctx.durationMin, ctx.priority, sim.occ, sim.bookings,
    { hist: sim.hist, arriveIn: ctx.arriveIn, budget: ctx.budget });
  return r.options.length ? r : null;
}

export async function pinReply(ctx: PinCtx, sim: SimInput, prevLotId: string | null, changed: string[] = []): Promise<PinReply> {
  const place = ctx.place!;
  const demo = demoResult(ctx, sim);
  if (demo) return demoReply(ctx, demo, prevLotId, changed);
  const cat = await catalogFor(place, ctx.priority, ctx.budget);
  return catalogReply(ctx, cat, prevLotId, changed);
}

function demoReply(ctx: PinCtx, r: Result, prevLotId: string | null, changed: string[]): PinReply {
  const place = ctx.place!;
  const av = r.options.filter((o) => o.available);
  if (!av.length) {
    // ничего не подходит — предлагаем поменять одно условие
    const priced = r.options.filter((o) => o.unavailable?.startsWith('Дороже'));
    if (ctx.budget != null && priced.length) {
      const min = Math.min(...priced.map(perHour));
      const nb = roundUp50(min);
      return { mode: 'demo', text: `У «${place.name}» нет ${ctx.budget === 0 ? 'бесплатных демо-парковок' : `демо-парковок ${budgetPhrase(ctx.budget)}`}: самая дешёвая — ${tenge(min)} в час.`,
        actions: [{ label: `Поднять до ${tenge(nb)}`, patch: { budget: nb } }] };
    }
    const reason = r.options[0]?.unavailable;
    return { mode: 'demo', text: `У «${place.name}» к вашему приезду всё закрыто${reason ? `: ${reason.toLowerCase()}` : ''}.`,
      actions: ctx.arriveIn != null ? [{ label: 'По времени в пути', patch: { arriveIn: null } }] : [{ label: 'Приеду через 15 мин', patch: { arriveIn: 15 } }] };
  }
  const best = av[0];
  const src = best.fcSource === 'ml' ? 'ML-модель' : 'эвристика';
  const s1 = `Езжайте на «${best.lot.name}»: ${best.walkMin} мин пешком, ${priceShort(best)}, ${fcShort(best)}, шанс ${pct(best.fc.pFree)} (демо-данные, ${src}).`;

  let s2: string;
  const prev = prevLotId ? r.options.find((o) => o.lot.id === prevLotId) : undefined;
  if (prev && prev.lot.id !== best.lot.id) {
    const dw = prev.walkMin - best.walkMin;
    s2 = prev.available && dw > 0 && prev.fc.pFree > best.fc.pFree
      ? `«${prev.lot.short}» дальше на ${dw} мин, зато там ${fcShort(prev)}, шанс ${pct(prev.fc.pFree)}.`
      : prev.available
      ? `Прошлый вариант «${prev.lot.short}»: ${fcShort(prev)}, шанс ${pct(prev.fc.pFree)}${prev.trendText ? ` — ${prev.trendText}` : ''}.`
      : `«${prev.lot.short}» теперь не подходит: ${prev.unavailable?.toLowerCase()}.`;
  } else if (ctx.budget != null && r.options.some((o) => o.unavailable?.startsWith('Дороже'))) {
    const n = r.options.filter((o) => o.unavailable?.startsWith('Дороже')).length;
    s2 = `${n} ${n === 1 ? 'вариант' : n < 5 ? 'варианта' : 'вариантов'} дороже бюджета, их не предлагаю.`;
  } else if (prev && changed.includes('priority') && ctx.priority === 'close') {
    s2 = 'Это и так самый близкий открытый вариант.';
  } else if (changed.includes('budget') && ctx.budget != null) {
    s2 = `В бюджет ${budgetPhrase(ctx.budget)} укладываются все ${av.length} открытых вариантов рядом.`;
  } else {
    const backup = av.slice(1).find((o) => o.fc.pFree >= 0.9) ?? av[1];
    s2 = backup
      ? `Запасной — «${backup.lot.short}»: ${backup.walkMin} мин пешком, шанс ${pct(backup.fc.pFree)}.`
      : 'Других открытых вариантов рядом нет.';
  }
  return { mode: 'demo', text: `${s1} ${s2}`, show: { lotId: best.lot.id, place }, source: best.fcSource, lotId: best.lot.id };
}

const low = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const nom = (o: CatOption) => (o.lot.name ? `«${o.lot.name}»` : o.title.toLowerCase());
const facts = (o: CatOption) => {
  const f = feeText(o.lot);
  const fee = f === 'Нет данных' ? 'цена — нет данных' : f === 'Платно, цена: нет данных' ? 'платно, сумма не указана' : low(f.replace(' (OSM)', ' по данным OSM'));
  const access = o.lot.access === 'private' ? ', частная — нужен пропуск' : o.lot.access === 'customers' ? ', для клиентов' : '';
  return `${fee}${access}, мест — ${o.lot.cap != null ? o.lot.cap : 'нет данных'}`;
};

function catalogReply(ctx: PinCtx, r: CatResult, prevLotId: string | null, changed: string[]): PinReply {
  const place = ctx.place!;
  const ok = r.options.filter((o) => o.inBudget === true);
  if (!r.options.length) {
    // предлагаем одно изменение: ближайший населённый пункт, где каталог знает парковки
    const ix = indexSync();
    const near = ix?.cities.filter((c) => c.lots >= 3)
      .map((c) => ({ c, d: distM(place.lat, place.lon, c.lat, c.lon) })).sort((a, b) => a.d - b.d)[0];
    return { mode: 'catalog', text: `В каталоге OSM нет парковок в ${fmtDist(r.radius)} от «${place.name}»${near ? `; ближайший город с парковками — ${near.c.ru}, ${fmtDist(near.d)}` : ''}.`,
      actions: near ? [{ label: `Искать в: ${near.c.ru}`, place: { id: `city:${near.c.i}`, name: `${near.c.ru}, центр`, address: '', lat: near.c.lat, lon: near.c.lon, kind: 'landmark' }, city: near.c }] : undefined };
  }
  if (!ok.length) {
    const why = r.unknownPrice && !r.overBudget
      ? `у всех ${r.unknownPrice} рядом цена в OSM не указана`
      : `у ${r.unknownPrice} цена не указана, ${r.overBudget} дороже`;
    return { mode: 'catalog', text: `Не могу обещать ${ctx.budget ? `парковку до ${tenge(ctx.budget)} в час` : 'бесплатную парковку'} у «${place.name}»: ${why}.`,
      actions: [{ label: 'Без ограничения по цене', patch: { budget: null } }] };
  }
  const best = ok[0];
  const nearestAll = Math.min(...r.options.map((o) => o.distM));
  const lead = best.distM <= nearestAll + 1 ? 'Ближе всего' : ctx.priority === 'close' ? 'Ближе всего из подходящих' : 'Советую';
  const s1 = `${lead} — ${nom(best)} в ${fmtDist(best.distM)} (${best.walkMin} мин пешком): ${facts(best)}.`;

  let s2: string;
  const prev = prevLotId ? r.options.find((o) => o.lot.id === prevLotId) : undefined;
  const closerPrivate = r.options.find((o) => o.lot.access === 'private' && o.distM + 50 < best.distM);
  if (prev && prev.lot.id === best.lot.id && changed.includes('priority') && ctx.priority === 'close') {
    s2 = 'Ближе этой парковки в каталоге нет; занятость — нет данных.';
  } else if (prev && prev.lot.id !== best.lot.id) {
    s2 = `Прошлый вариант — в ${fmtDist(prev.distM)}${prev.inBudget === null && ctx.budget != null ? ', но его цена не указана' : prev.inBudget === false ? ', но дороже бюджета' : ''}; занятость по OSM неизвестна.`;
  } else if (ctx.budget != null && (r.unknownPrice || r.overBudget)) {
    s2 = `Ещё ${r.unknownPrice + r.overBudget} рядом не предлагаю: ${r.unknownPrice ? 'цена не указана' : 'дороже бюджета'}; занятость — нет данных.`;
  } else if (closerPrivate) {
    s2 = `Ближе есть частная парковка в ${fmtDist(closerPrivate.distM)}, но туда нужен пропуск; занятость — нет данных.`;
  } else if (ctx.arriveIn != null) {
    s2 = `Прогноз на ${ctx.arriveIn} мин не построю: датчиков занятости в каталоге нет.`;
  } else {
    const backup = ok.find((o) => o !== best && o.lot.access !== 'private');
    s2 = backup ? `Занятость — нет данных, поэтому запасной: ${nom(backup)} в ${fmtDist(backup.distM)}.` : 'Занятость — нет данных, других вариантов рядом нет.';
  }
  return { mode: 'catalog', text: `${s1} ${s2}`, show: { lotId: best.lot.id, place }, source: 'osm', lotId: best.lot.id };
}
