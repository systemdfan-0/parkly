// Ответ Пина. Коротко — рекомендация, ближайшее полезное число и причина выбора (≤ 2 предложений):
//   «„Улица Панфилова“, 5 мин пешком. К 18:40 ожидается 2–5 мест, а у „У театра“ шанс только 41%.»
// Подробности (цена, шанс, источник прогноза, запасной вариант, что изменилось) — в details, по нажатию.
// Демо-парковки Алматы — recommend() с ML-прогнозом на 5–15 мин; остальная страна — каталог OSM
// (там нет занятости и почти нет цен, это говорим прямо).
import type { Place } from '../data/places';
import type { Booking } from './model';
import { recommend, rangeText, type Option, type Result } from './recommend';
import { tenge } from './pricing';
import { fmtTime, fmtDur } from './time';
import { spotsWord } from '../format';
import { fmtDist } from './geo';
import { catalogFor, feeText, suitable, type CatOption, type CatResult } from '../catalog/rank';
import { distM, indexSync } from '../catalog/data';
import type { PinCtx } from './pinText';

export interface PinAction { label: string; patch?: Partial<PinCtx>; place?: Place; city?: PinCtx['city'] }
export interface PinReply {
  /** Короткий ответ: не больше двух предложений. */
  text: string;
  /** Подробности — открываются по нажатию «Подробнее». */
  details?: string[];
  mode: 'demo' | 'catalog' | 'none';
  /** Что показать по кнопке «На карте» — именно та парковка, о которой ответ. */
  show?: { lotId: string; place: Place };
  /** Условия, при которых посчитан ответ (их же получит экран подбора по «На карте»). */
  ctx?: PinCtx;
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
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const low = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

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
  const r = demo ? demoReply(ctx, demo, prevLotId, changed) : catalogReply(ctx, await catalogFor(place, ctx.priority, ctx.budget), prevLotId, changed);
  return { ...r, ctx };
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
  const prev = prevLotId ? r.options.find((o) => o.lot.id === prevLotId) : undefined;
  const closest = [...av].sort((a, b) => a.walkMin - b.walkMin || b.fc.pFree - a.fc.pFree)[0];
  const overBudget = r.options.filter((o) => o.unavailable?.startsWith('Дороже')).length;

  // причина выбора — одна, самая полезная
  let why: string;
  if (prev && prev.lot.id !== best.lot.id) {
    const dw = prev.walkMin - best.walkMin;
    if (!prev.available) why = `прошлый вариант «${prev.lot.short}» теперь не подходит: ${low(prev.unavailable ?? 'закрыт')}`;
    else if (dw > 0) why = `на ${dw} мин ближе, чем «${prev.lot.short}»${best.fc.pFree + 0.05 < prev.fc.pFree ? `, но шанс ниже: ${pct(best.fc.pFree)}` : ''}`;
    else if (prev.fc.pFree + 0.05 < best.fc.pFree) why = `а у «${prev.lot.short}» к этому времени шанс только ${pct(prev.fc.pFree)}`;
    else if (best.price.total < prev.price.total) why = `на ${tenge(prev.price.total - best.price.total)} дешевле, чем «${prev.lot.short}»`;
    else why = `шанс ${pct(best.fc.pFree)}`;
  } else if (prev && changed.includes('priority') && ctx.priority === 'close') {
    why = 'ближе открытого варианта нет';
  } else if (changed.includes('budget') && ctx.budget != null) {
    why = perHour(best) === 0 ? 'бесплатно, в бюджете' : `в бюджете: ${tenge(perHour(best))} в час`;
  } else if (closest !== best && closest.fc.pFree + 0.03 < best.fc.pFree) {
    why = `а у «${closest.lot.short}» ближе, но шанс только ${pct(closest.fc.pFree)}`;
  } else if (closest === best) {
    why = `ближе всех, шанс ${pct(best.fc.pFree)}`;
  } else {
    why = `шанс ${pct(best.fc.pFree)}, ${priceShort(best)}`;
  }
  const s1 = `«${best.lot.short}», ${best.walkMin} мин пешком.`;
  const s2 = `К ${fmtTime(best.eta)} ожидается ${rangeText(best.fc)} ${spotsWord(best.fc.hi)}${why.startsWith('а ') ? ', ' : ' — '}${why}.`;

  const src = best.fcSource === 'ml' ? 'ML-модель на телефоне' : 'эвристика (до приезда больше 15 мин)';
  const details = [
    `${best.lot.name}: ${priceShort(best)}, ${best.driveMin} мин в пути, шанс найти место ${pct(best.fc.pFree)}.`,
    `Прогноз: ${src}; данные демо-симуляции Алматы.`,
  ];
  const backup = av.slice(1).find((o) => o.fc.pFree >= 0.9) ?? av[1];
  details.push(backup ? `Запасной — «${backup.lot.short}»: ${backup.walkMin} мин пешком, ${fcShort(backup)}, шанс ${pct(backup.fc.pFree)}.` : 'Других открытых вариантов рядом нет.');
  if (closest !== best && !why.includes(closest.lot.short)) details.push(`Ближе всех — «${closest.lot.short}» (${closest.walkMin} мин), ${fcShort(closest)}, шанс ${pct(closest.fc.pFree)}.`);
  if (prev && prev.lot.id !== best.lot.id && prev.available) details.push(`Прошлый вариант «${prev.lot.short}»: ${fcShort(prev)}, шанс ${pct(prev.fc.pFree)}${prev.trendText ? ` — ${prev.trendText}` : ''}.`);
  if (ctx.budget != null && overBudget) details.push(`${overBudget} ${overBudget === 1 ? 'вариант' : overBudget < 5 ? 'варианта' : 'вариантов'} дороже бюджета — их не предлагаю.`);
  return { mode: 'demo', text: `${s1} ${s2}`, details, show: { lotId: best.lot.id, place }, source: best.fcSource, lotId: best.lot.id };
}

const nom = (o: CatOption) => (o.lot.name ? `«${o.lot.name}»` : o.title);
const feeFact = (o: CatOption) => {
  const f = feeText(o.lot);
  return f === 'Нет данных' ? 'цена — нет данных' : f === 'Платно, цена: нет данных' ? 'платно, сумма не указана' : low(f.replace(' (OSM)', ' по OSM'));
};

function catalogReply(ctx: PinCtx, r: CatResult, prevLotId: string | null, changed: string[]): PinReply {
  const place = ctx.place!;
  if (!r.options.length) {
    // предлагаем одно изменение: ближайший населённый пункт, где каталог знает парковки
    const ix = indexSync();
    const near = ix?.cities.filter((c) => c.lots >= 3)
      .map((c) => ({ c, d: distM(place.lat, place.lon, c.lat, c.lon) })).sort((a, b) => a.d - b.d)[0];
    return { mode: 'catalog', text: `В каталоге OSM нет парковок в ${fmtDist(r.searched ?? r.radius)} от «${place.name}»${near ? `; ближайший город с парковками — ${near.c.ru}, ${fmtDist(near.d)}` : ''}.`,
      actions: near ? [{ label: `Искать в: ${near.c.ru}`, place: { id: `city:${near.c.i}`, name: `${near.c.ru}, центр`, address: '', lat: near.c.lat, lon: near.c.lon, kind: 'landmark' }, city: near.c }] : undefined };
  }
  const ok = r.options.filter(suitable);
  if (!ok.length) {
    const priv = r.options.filter((o) => o.lot.access === 'private');
    const searched = fmtDist(r.searched ?? r.radius);
    if (priv.length === r.options.length) {
      return { mode: 'catalog', text: `У «${place.name}» в ${searched} только частные парковки (${priv.length}) — нужен пропуск. Ближайшая — ${nom(priv[0])} в ${fmtDist(priv[0].distM)}.`,
        show: { lotId: priv[0].lot.id, place }, lotId: priv[0].lot.id, source: 'osm',
        details: ['Открытых для всех парковок OSM не знает в этом радиусе. Доступ «private» означает: въезд по пропуску или для жильцов.'] };
    }
    const why = r.unknownPrice && !r.overBudget ? `у всех ${r.unknownPrice} рядом цена в OSM не указана` : `у ${r.unknownPrice} цена не указана, ${r.overBudget} дороже`;
    return { mode: 'catalog', text: `Не могу обещать ${ctx.budget ? `парковку до ${tenge(ctx.budget)} в час` : 'бесплатную парковку'} у «${place.name}»: ${why}. Искал до ${searched}.`,
      actions: [{ label: 'Без ограничения по цене', patch: { budget: null } }] };
  }
  const best = ok[0];
  const nearestAll = Math.min(...r.options.map((o) => o.distM));
  const prev = prevLotId ? r.options.find((o) => o.lot.id === prevLotId) : undefined;
  let why: string;
  if (r.expanded) why = `в ${fmtDist(r.expanded.from)} ${r.expanded.why}, поэтому искал до ${fmtDist(r.radius)}`;
  else if (prev && prev.lot.id === best.lot.id && changed.includes('priority') && ctx.priority === 'close') why = ctx.budget != null ? 'ближе нет открытой с известной ценой в бюджете' : 'ближе открытой парковки в каталоге нет';
  else if (prev && prev.lot.id !== best.lot.id) why = `прошлый вариант — в ${fmtDist(prev.distM)}${prev.inBudget === false ? ', но дороже бюджета' : prev.inBudget === null && ctx.budget != null ? ', но без цены' : ''}`;
  else if (best.distM <= nearestAll + 1) why = 'ближайшая открытая для всех';
  else if (r.privateNear.length) why = `ближе только частные — туда нужен пропуск`;
  else if (ctx.budget != null) why = `ближайшая в бюджете ${budgetPhrase(ctx.budget)}`;
  else why = 'лучший баланс расстояния и известных данных';
  const s1 = `${cap(nom(best))}, ${best.walkMin} мин пешком (${fmtDist(best.distM)}).`;
  const s2 = `${cap(feeFact(best))}, занятость неизвестна — ${why}.`;

  const details: string[] = [
    `Мест — ${best.lot.cap != null ? best.lot.cap : 'нет данных'}; доступ — ${best.lot.access === 'customers' ? 'для клиентов' : best.lot.access === 'public' ? 'для всех' : 'не указан'} (OSM).`,
    'Датчиков занятости у парковок каталога нет, поэтому прогноз мест не строю.',
  ];
  if (r.privateNear.length) details.push(`Отдельно — частные ближе: ${r.privateNear.map((o) => `${nom(o)} в ${fmtDist(o.distM)}`).join(', ')}; туда нужен пропуск.`);
  const backup = ok.find((o) => o !== best);
  details.push(backup ? `Запасной — ${nom(backup)} в ${fmtDist(backup.distM)} (${backup.walkMin} мин), ${feeFact(backup)}.` : 'Других открытых вариантов рядом нет.');
  if (ctx.budget != null && (r.unknownPrice || r.overBudget)) details.push(`Не предлагаю: ${r.overBudget} дороже бюджета, ${r.unknownPrice} без цены.`);
  if (ctx.arriveIn != null) details.push(`Прогноз на ${ctx.arriveIn} мин не построю: занятость этих парковок неизвестна.`);
  return { mode: 'catalog', text: `${s1} ${s2}`, details, show: { lotId: best.lot.id, place }, source: 'osm', lotId: best.lot.id };
}
