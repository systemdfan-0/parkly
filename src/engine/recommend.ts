import { LOTS, type Lot, type Place } from '../data/places';
import { haversine, driveMinutes, WALK_DETOUR, WALK_M_PER_MIN } from './geo';
import { forecast, freeNow, isOpenAt, nextCloseMs, nextOpenMs, reservedAt, type Booking, type Forecast } from './model';
import { priceFor, tenge, type Price } from './pricing';
import { TREND_REASON } from './profiles';
import { MIN, fmtTime, fmtDur } from './time';
import { spotsWord } from '../format';
import { predictML, ML_MAX_H } from '../ml/predict';

export type Priority = 'balanced' | 'close' | 'cheap' | 'reliable';
export type Tag = 'best' | 'closest' | 'cheapest' | 'reliable';

export const TAG_LABEL: Record<Tag, string> = {
  best: 'Лучший выбор', closest: 'Ближе ко входу', cheapest: 'Дешевле', reliable: 'Надёжнее',
};
export const PRIORITY_LABEL: Record<Priority, string> = {
  balanced: 'Баланс', close: 'Ближе', cheap: 'Дешевле', reliable: 'Надёжнее',
};

// Веса: минуты пешком, «минуты риска» (кружить, если места нет), цена (в минутах по 50 ₸)
const WEIGHTS: Record<Priority, { walk: number; risk: number; price: number }> = {
  balanced: { walk: 1, risk: 1, price: 1 },
  close: { walk: 2.6, risk: 1, price: 0.4 },
  cheap: { walk: 0.6, risk: 1, price: 2.6 },
  reliable: { walk: 0.8, risk: 3, price: 0.6 },
};
export const SEARCH_PENALTY_MIN = 15; // если места нет: круг по району + переезд на запасную парковку
export const TENGE_PER_MIN = 50;      // во сколько водитель оценивает минуту своего времени
export const STREET_SEARCH_MIN = 5;   // без брони: найти свободное место вдоль улицы и оплатить

export interface Option {
  lot: Lot;
  walkM: number;
  walkMin: number;
  driveMin: number;
  eta: number;
  freeNow: number;
  reserved: number;
  fc: Forecast;
  /** Откуда прогноз: офлайн-модель (до 15 мин) или эвристика потоков (дальше / нет замеров). */
  fcSource: 'ml' | 'heuristic';
  price: Price;
  durationMin: number;
  riskMin: number;
  score: number;
  available: boolean;
  unavailable?: string;
  warning?: string;
  tags: Tag[];
  reason: string;
  trend: 'up' | 'down' | 'flat';
  trendText?: string;
  compare: { label: string; good: boolean }[];
}

export interface Result {
  options: Option[];
  radius: number;
  expanded: boolean;
}

export function lotsNear(place: { lat: number; lon: number }, radius: number): Lot[] {
  return LOTS.filter((l) => haversine(place.lat, place.lon, l.lat, l.lon) <= radius);
}

export interface Extra {
  /** Занятость за последние 15 минут по минутам — вход ML-модели. */
  hist?: Record<string, number[]>;
  /** «Приеду через N минут» вместо расчётного времени в пути. */
  arriveIn?: number | null;
  /** Бюджет, ₸ в час (из запроса Пину); дороже — вариант недоступен. */
  budget?: number | null;
}

/** Прогноз к приезду: ML-дерево, если горизонт ≤ 15 мин и есть замеры; иначе эвристика. */
export function arrivalForecast(lot: Lot, occNow: number, now: number, horizon: number, bookings: Booking[], hist?: number[]):
  { fc: Forecast; source: 'ml' | 'heuristic' } {
  const eta = now + horizon * MIN;
  if (hist && hist.length >= 16 && horizon <= ML_MAX_H && isOpenAt(lot, now) && isOpenAt(lot, eta)) {
    const res = reservedAt(lot.id, now, bookings);
    const free = (occ: number) => Math.max(0, lot.capacity - occ - res);
    const n = hist.length;
    const b = predictML(lot, now, { now: free(occNow), m5: free(hist[n - 6]), m10: free(hist[n - 11]), m15: free(hist[n - 16]) }, horizon)!;
    // брони Parkly, которые закончатся до приезда, вернут места
    const back = res - reservedAt(lot.id, eta, bookings);
    const add = (v: number) => Math.min(lot.capacity, v + back);
    return { fc: { lo: add(b.lo), mid: add(b.mid), hi: add(b.hi), pFree: back > 0 ? Math.max(b.pFree, 0.99) : b.pFree, series: [] }, source: 'ml' };
  }
  return { fc: forecast(lot, occNow, now, horizon, bookings), source: 'heuristic' };
}

export function buildOption(
  lot: Lot, place: Place, origin: Place, now: number, wantMin: number,
  occ: Record<string, number>, bookings: Booking[], extra: Extra = {},
): Option {
  const walkM = lot.walkM ?? haversine(lot.lat, lot.lon, place.lat, place.lon) * WALK_DETOUR;
  const walkMin = Math.max(1, Math.ceil(walkM / WALK_M_PER_MIN));
  const driveMin = extra.arriveIn ?? driveMinutes(haversine(origin.lat, origin.lon, lot.lat, lot.lon), now);
  const eta = now + driveMin * MIN;
  const o = occ[lot.id] ?? 0;
  const { fc, source: fcSource } = arrivalForecast(lot, o, now, driveMin, bookings, extra.hist?.[lot.id]);
  let durationMin = wantMin;
  let available = true;
  let unavailable: string | undefined;
  let warning: string | undefined;

  if (lot.closedReason) { available = false; unavailable = lot.closedReason; }
  else if (!isOpenAt(lot, eta)) {
    available = false;
    const op = nextOpenMs(lot, eta);
    unavailable = `Закрыта к вашему приезду${op ? `, откроется в ${fmtTime(op)}` : ''}`;
  } else {
    const close = nextCloseMs(lot, eta);
    if (close) {
      const left = Math.floor((close - eta) / MIN);
      if (left < 30) { available = false; unavailable = `Закрывается в ${fmtTime(close)}: после приезда останется ${left} мин`; }
      else if (left < durationMin) { durationMin = Math.floor(left / 30) * 30; warning = `Работает до ${fmtTime(close)} — стоянка не дольше ${fmtDur(durationMin)}`; }
    }
    if (lot.maxMin && durationMin > lot.maxMin) { durationMin = lot.maxMin; warning = `Стоянка не дольше ${fmtDur(lot.maxMin)}`; }
  }

  const price = priceFor(lot, eta, durationMin);
  if (available && extra.budget != null && durationMin > 0) {
    const ph = Math.round(price.total / (durationMin / 60));
    if (ph > extra.budget) { available = false; unavailable = extra.budget === 0 ? `Дороже бюджета: платная, ${tenge(ph)} в час` : `Дороже ${tenge(extra.budget)} в час: ${tenge(ph)} в час`; }
  }
  const fNow = freeNow(lot, o, now, bookings);
  const trendDelta = fc.mid - fNow;
  const trend = trendDelta >= 2 ? 'up' : trendDelta <= -2 ? 'down' : 'flat';
  const riskMin = (1 - fc.pFree) * SEARCH_PENALTY_MIN;
  return {
    lot, walkM, walkMin, driveMin, eta, freeNow: fNow, reserved: reservedAt(lot.id, now, bookings), fc, fcSource, price, durationMin,
    riskMin, score: 0, available, unavailable, warning, tags: [], reason: '', trend,
    trendText: trend === 'flat' ? undefined : TREND_REASON[lot.type][trend], compare: [],
  };
}

const pct = (p: number) => `${Math.round(p * 100)}%`;
export const rangeText = (o: { lo: number; hi: number }) => (o.lo === o.hi ? `${o.lo}` : `${o.lo}–${o.hi}`);

export function recommend(
  place: Place, origin: Place, now: number, wantMin: number, priority: Priority,
  occ: Record<string, number>, bookings: Booking[], extra: Extra = {},
): Result {
  let radius = place.radius ?? 750;
  let lots = lotsNear(place, radius);
  let expanded = false;
  if (!lots.length) { radius = 1500; lots = lotsNear(place, radius); expanded = lots.length > 0; }
  const w = WEIGHTS[priority];
  const opts = lots.map((l) => buildOption(l, place, origin, now, wantMin, occ, bookings, extra));
  for (const o of opts) {
    o.score = o.driveMin + o.walkMin * w.walk + (o.riskMin + (o.lot.bookable ? 0 : STREET_SEARCH_MIN)) * w.risk + (o.price.total / TENGE_PER_MIN) * w.price;
  }
  const av = opts.filter((o) => o.available);
  const un = opts.filter((o) => !o.available);
  av.sort((a, b) => a.score - b.score);

  if (av.length) {
    const best = av[0];
    best.tags.push('best');
    const pick = (cmp: (a: Option, b: Option) => number) => [...av].sort(cmp)[0];
    const closest = pick((a, b) => a.walkMin - b.walkMin || a.score - b.score);
    const cheapest = pick((a, b) => a.price.total - b.price.total || a.walkMin - b.walkMin);
    const reliable = pick((a, b) => b.fc.pFree - a.fc.pFree || b.fc.mid - a.fc.mid);
    if (av.length > 1) {
      closest.tags.push('closest');
      // «Дешевле» не ставим, если цены у всех одинаковые
      if (av.some((o) => o.price.total !== cheapest.price.total)) cheapest.tags.push('cheapest');
      reliable.tags.push('reliable');
    }
    for (const o of av) explain(o, best, av.length);
  }
  for (const o of un) o.reason = o.unavailable ?? '';
  return { options: [...av, ...un], radius, expanded };
}

function explain(o: Option, best: Option, n: number) {
  const eta = fmtTime(o.eta);
  const fcText = `к ${eta} ожидается ${rangeText(o.fc)} ${spotsWord(o.fc.hi)}`;
  const priceText = o.price.total === 0 ? 'бесплатно' : `${tenge(o.price.total)} за ${fmtDur(o.durationMin)}`;
  const trend = o.trendText ? ` — ${o.trendText}` : '';
  const primary = o.tags[0];

  if (primary === 'best') {
    if (n === 1) o.reason = `Единственный открытый вариант рядом: ${o.walkMin} мин пешком, шанс найти место ${pct(o.fc.pFree)}.`;
    else if (o.tags.length >= 3) o.reason = `Здесь всё сходится: ${o.walkMin} мин до входа, ${priceText}, шанс ${pct(o.fc.pFree)}.`;
    else if (o.trend === 'up') o.reason = `Сейчас ${o.freeNow}, но ${fcText}${trend}. ${o.walkMin} мин пешком, ${priceText}.`;
    else o.reason = `Лучший баланс: ${o.walkMin} мин пешком, ${priceText}, шанс найти место ${pct(o.fc.pFree)}.`;
  } else if (primary === 'closest') {
    o.reason = o.fc.pFree < 0.8
      ? `Ближе всех — ${o.walkMin} мин до входа, но ${fcText}${trend}: шанс найти место ${pct(o.fc.pFree)}.`
      : `Ближе всех — ${o.walkMin} мин до входа, и места к приезду почти наверняка будут.`;
  } else if (primary === 'cheapest') {
    const diff = best.price.total - o.price.total;
    o.reason = diff > 0
      ? `Дешевле всех: ${priceText} — на ${tenge(diff)} меньше лучшего варианта, но ${o.walkMin} мин пешком${o.lot.bookable ? '' : ', без брони'}.`
      : `Дешевле всех: ${priceText}, ${o.walkMin} мин пешком.`;
  } else if (primary === 'reliable') {
    o.reason = `Надёжнее всех: шанс ${pct(o.fc.pFree)}, ${fcText}. Идти ${o.walkMin} мин.`;
  } else {
    const dp = o.price.total - best.price.total, dw = o.walkMin - best.walkMin;
    const bits: string[] = [];
    if (dp > 0) bits.push(`на ${tenge(dp)} дороже`);
    if (dp < 0) bits.push(`на ${tenge(-dp)} дешевле`);
    if (dw > 0) bits.push(`на ${dw} мин дальше`);
    if (dw < 0) bits.push(`на ${-dw} мин ближе`);
    if (o.fc.pFree + 0.05 < best.fc.pFree) bits.push(`шанс ниже (${pct(o.fc.pFree)})`);
    o.reason = bits.length ? `По сравнению с «${best.lot.short}»: ${bits.join(', ')}.` : `Почти как «${best.lot.short}»: ${fcText}.`;
  }
  if (o.warning) o.reason += ` ${o.warning}.`;

  if (o !== best) {
    const dw = o.walkMin - best.walkMin, dp = o.price.total - best.price.total;
    if (dw) o.compare.push({ label: `${dw > 0 ? '+' : '−'}${Math.abs(dw)} мин пешком`, good: dw < 0 });
    if (dp) o.compare.push({ label: `${dp > 0 ? '+' : '−'}${tenge(Math.abs(dp))}`, good: dp < 0 });
    const dpf = Math.round((o.fc.pFree - best.fc.pFree) * 100);
    if (Math.abs(dpf) >= 5) o.compare.push({ label: `шанс ${dpf > 0 ? '+' : '−'}${Math.abs(dpf)}%`, good: dpf > 0 });
  }
}
