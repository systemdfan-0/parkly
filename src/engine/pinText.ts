// Понимание свободного текста для Пина — правила и словари, без сети и платных API.
// Из фразы достаём: город, место назначения, бюджет (₸/ч), время приезда, длительность и приоритет.
// Короткие уточнения («а поближе?», «тогда до 700») дополняют предыдущий запрос.
import type { Priority } from './recommend';
import type { Place } from '../data/places';
import { distM, type CatalogIndex, type City, type Poi } from '../catalog/data';
import { ambiguous, byCategory, exactNear, matchCities, matchPlaces, type GeoHit } from '../catalog/geo';
import { GENERIC_CAT, fold, tokens } from '../catalog/text';

export interface Slots {
  budget?: number | null;       // ₸ в час; 0 — только бесплатно; null — без ограничения
  arriveIn?: number | null;     // минут до приезда; null — по времени в пути
  durationMin?: number;
  priority?: Priority;
}

export interface PinCtx {
  place: Place | null;
  city: City | null;
  budget: number | null;
  arriveIn: number | null;
  durationMin: number;
  priority: Priority;
}

export type Understood =
  | { kind: 'query'; ctx: PinCtx; followUp: boolean; changed: (keyof Slots | 'place')[] }
  | { kind: 'ask-place'; ctx: PinCtx; question: string; options: GeoHit[] }
  | { kind: 'ask-city'; ctx: PinCtx; question: string; options: GeoHit[] }
  | { kind: 'not-found'; ctx: PinCtx; text: string }
  | { kind: 'need-place'; ctx: PinCtx };

/** Конец слова: в JS `\\b` не работает с кириллицей. */
const E = '(?![а-яёa-z])';
const num = (s: string) => parseInt(s.replace(/\s/g, ''), 10);

/** Бюджет, время приезда, длительность и приоритет — по исходной строке (тут важны «₸», «:», «в час»). */
export function extractSlots(text: string): Slots {
  const t = ' ' + text.toLowerCase().replace(/ё/g, 'е').replace(/ /g, ' ') + ' ';
  const s: Slots = {};

  // ---- бюджет
  if (/без\s+ограничени[яй]\s+(по\s+)?цен|люб(ая|ой)\s+цен|цена\s+не\s*важна|неважно\s+сколько/.test(t)) s.budget = null;
  else if (/бесплатн|тегін|без\s+оплаты|не\s+платить/.test(t)) s.budget = 0;
  else {
    const cur = `(?:тенге|теңге|тг|₸|т${E})`;
    const k = `(?:\\s*(тыс(?:\\.|яч[аи]?)?|к)${E})?`;
    const m =
      t.match(new RegExp(`(?:до|не\\s+дороже|не\\s+больше|максимум|макс\\.?|в\\s+пределах|бюджет|за)\\s*(\\d[\\d ]{0,6}?)${k}\\s*${cur}?(?![\\d:])(?!\\s*(?:мин|час|ч${E}|:))`)) ??
      t.match(new RegExp(`(\\d[\\d ]{0,6}?)${k}\\s*${cur}`)) ??
      t.match(/(\d[\d ]{0,6}?)\s*тең?гег?е?\s*дейін/);
    if (m) {
      let v = num(m[1]);
      if (m[2]) v *= 1000;
      if (v >= 50 && v <= 20000) s.budget = v;
    }
  }

  // ---- время приезда
  let a: RegExpMatchArray | null;
  if ((a = t.match(/через\s+(\d{1,3})\s*(?:мин|м(?![а-я])|минут)/)) || (a = t.match(/(\d{1,3})\s*минут(?:тан|тен)?\s*кейін/))) s.arriveIn = +a[1];
  else if (/через\s+(пол\s*часа|полчаса|30\s*мин)/.test(t)) s.arriveIn = 30;
  else if ((a = t.match(/через\s+(\d)\s*час/))) s.arriveIn = +a[1] * 60;
  else if (/через\s+час/.test(t)) s.arriveIn = 60;
  else if (/через\s+(\d{1,3})\b(?!\s*(?:тенге|тг|₸))/.test(t) && (a = t.match(/через\s+(\d{1,3})\b/))) s.arriveIn = +a[1];
  else if (/по\s+маршруту|как\s+доеду|когда\s+доеду/.test(t)) s.arriveIn = null;

  // ---- сколько стоять
  if ((a = t.match(/на\s+(\d{1,2})\s*(?:час|ч(?![а-я]))/))) s.durationMin = +a[1] * 60;
  else if (/на\s+полчаса/.test(t)) s.durationMin = 30;
  else if (/на\s+час(?![а-я])/.test(t)) s.durationMin = 60;
  else if ((a = t.match(/на\s+(\d{2,3})\s*мин/))) s.durationMin = +a[1];

  // ---- что важнее
  if (/поближе|ближе|ближайш|ближн|жақын|жакын/.test(t)) s.priority = 'close';
  else if (/надежн|наверняка|гарантир|чтобы\s+(точно\s+)?было\s+место|сенімді/.test(t)) s.priority = 'reliable';
  else if (/(подешевле|дешевле|дешев|арзан)(?!\s*\d)/.test(t) && s.budget === undefined) s.priority = 'cheap';
  else if (/баланс|оптимальн|как\s+обычно/.test(t)) s.priority = 'balanced';
  return s;
}

/** Слова, которые не являются названием места. Сравниваем после fold (й→и, қ→к…). */
const STOP = new Set(`у возле около рядом с со к ко в во на до от по для за где куда как какая какую какои лучше бы мне нам нужно надо хочу
можно встать поставить оставить припарковаться парковаться припарковать паркануться парковка парковку парковки паркинг паркинга стоянка стоянку
стоянки машину машина авто еду поеду едем приеду приедем буду будем через мин минут минуты минуту минутку тенге тенгеге тг т час часа часов ч
а тогда и еще ещё пожалуиста пж подскажи подскажите посоветуи найди наиди найти наити покажи мест место места свободное свободные свободно есть ли там тут
сеичас сегодня вечером утром днем рядом ближе поближе ближаишая ближаишую дешевле подешевле бесплатно бесплатная бесплатную бесплатнои надежнее надежная
лучшая лучшии лучшее хорошая вариант варианты что чтобы было точно если а-то ну ок океи спасибо привет здравствуите пин бюджет максимум макс не дороже больше
тыс тысяч тысячи к пол полчаса г город городе каида турак колик кою жанында манында касында деиин кеиин минуттан минуттен кала каласы каласында бар ма ме ба бе
отт ли раз рази пешком идти близко далеко маршруту доеду когда карте карту карта показать покажи открои
футбол матч матча концерт концерта спектакль спектакля шоу кино игра игру`.split(/\s+/).map(fold));

export const EMPTY_CTX = (p: Partial<PinCtx> = {}): PinCtx => ({ place: null, city: null, budget: null, arriveIn: null, durationMin: 120, priority: 'balanced', ...p });

const FOLLOW = /^\s*(а|тогда|и|ещ[её]|лучше|давай|ну|если)(?![а-яё])/i;

export function understand(text: string, prev: PinCtx, ix: CatalogIndex, pois: Poi[] | null, near?: { lat: number; lon: number } | null): Understood {
  const slots = extractSlots(text);
  const qw = tokens(text);
  // «Шугыла», «Аксай-4» — точное название места рядом с картой важнее одноимённого посёлка в другой области
  const ex = !Object.keys(slots).length ? exactNear(ix, pois, text, near ?? prev.city ?? null) : null;
  if (ex) return { kind: 'query', followUp: false, changed: ['place'], ctx: { ...EMPTY_CTX({ durationMin: prev.durationMin, priority: prev.priority }), place: ex.place, city: ex.city } };
  // «в Астане», «г. Шымкент», «Астанада» — контекст города
  const ctxIdx = new Set<number>();
  qw.forEach((w, i) => { if (i > 0 && ['в', 'во', 'г', 'город', 'городе', 'из', 'по'].includes(qw[i - 1])) ctxIdx.add(i); if (/(да|де|та|те)$/.test(w) && w.length > 5) ctxIdx.add(i); });
  const cityHits = matchCities(ix, qw, ctxIdx);
  const city = cityHits[0]?.city ?? null;

  const skip = new Set<number>();
  qw.forEach((w, i) => { if (STOP.has(w) || /^\d+$/.test(w) || /^\d+(мин|ч|тг|т)$/.test(w)) skip.add(i); });
  const cityUsed = city ? cityHits[0].used : new Set<number>();
  const rest = qw.filter((_, i) => !skip.has(i) && !cityUsed.has(i));

  const searchCity = city ?? prev.city;
  // слова города остаются доступны названию («Атырау Плаза»), но место только из названия города не считаем
  let hits = rest.length ? matchPlaces(ix, pois, qw, { city: searchCity, strictCity: !!city, near: searchCity ?? near ?? null }, skip)
    .filter((h) => [...h.used].some((i) => !cityUsed.has(i))) : [];
  // «вокзал в Караганде», «рынок Шымкент» — только общее слово + город: ищем по категории
  const cats = rest.map((w) => GENERIC_CAT[w]).filter(Boolean);
  if (searchCity && cats.length && rest.every((w) => GENERIC_CAT[w]) && !hits.some((h) => h.score >= 95)) {
    const byCat = byCategory(ix, pois, cats[0], searchCity);
    if (byCat.length) hits = byCat.map((h, i) => ({ ...h, score: i === 0 && (byCat.length === 1 || byCat[0].score - byCat[1].score > 10) ? 100 : 90 }));
    else return { kind: 'not-found', ctx: prev, text: `${rest.join(' ')} в ${cityIn(searchCity.ru)}` };
  }
  const changed = (Object.keys(slots) as (keyof Slots)[]);
  const merge = (base: PinCtx): PinCtx => ({
    ...base,
    ...('budget' in slots ? { budget: slots.budget ?? null } : {}),
    ...('arriveIn' in slots ? { arriveIn: slots.arriveIn ?? null } : {}),
    ...(slots.durationMin ? { durationMin: slots.durationMin } : {}),
    ...(slots.priority ? { priority: slots.priority } : {}),
  });

  const good = hits.filter((h) => h.score >= 80);
  if (good.length) {
    const amb0 = city ? null : ambiguous(good, rest);
    // «Шугыла» есть в Алматы, Шымкенте и Атырау: если ровно один вариант рядом с картой/прошлым городом — берём его без вопроса
    const here = near ?? prev.city;
    const local = amb0 && here ? amb0.filter((h) => distM(h.place.lat, h.place.lon, here.lat, here.lon) < 30_000) : [];
    const amb = local.length === 1 ? null : amb0;
    const isFollow = FOLLOW.test(text);
    // новое место: условия из прошлого запроса сохраняем только для уточнения «а у …?»
    const base = isFollow ? prev : EMPTY_CTX({ durationMin: prev.durationMin });
    if (amb) {
      const byCity = new Set(amb.map((h) => h.city?.i ?? -1)).size === amb.length;
      return { kind: 'ask-place', ctx: merge(base), options: amb,
        question: byCity ? `Уточните город: ${listOr(amb.map((h) => h.city?.ru ?? h.hint))}?` : `Какое место: ${listOr(amb.map((h) => `«${h.place.name}»${amb.filter((x) => fold(x.place.name) === fold(h.place.name)).length > 1 ? ` (${h.hint.split(',')[0].toLowerCase()})` : ''}`))}?` };
    }
    const h = local.length === 1 ? local[0] : good[0];
    return { kind: 'query', followUp: isFollow, changed: ['place', ...changed], ctx: merge({ ...base, place: h.place, city: h.city ?? (h.kind === 'poi' ? null : searchCity ?? null) }) };
  }

  // осталось значимое слово, но такого места нет
  const unknown = rest.filter((w) => w.length >= 3);
  if (unknown.length && !changed.length) {
    return { kind: 'not-found', ctx: prev, text: rest.join(' ') };
  }
  if (city && (!prev.place || prev.city?.i !== city.i)) {
    return { kind: 'ask-city', ctx: merge({ ...EMPTY_CTX({ durationMin: prev.durationMin }), city }), options: [],
      question: `Куда именно в ${cityIn(city.ru)}? Напишите место или адрес.` };
  }
  if (prev.place && (changed.length || FOLLOW.test(text))) {
    return { kind: 'query', followUp: true, changed, ctx: merge(prev) };
  }
  if (unknown.length) return { kind: 'not-found', ctx: prev, text: rest.join(' ') };
  return { kind: 'need-place', ctx: merge(prev) };
}

function listOr(xs: string[]) {
  const u = [...new Set(xs)];
  return u.length <= 1 ? u.join('') : `${u.slice(0, -1).join(', ')} или ${u[u.length - 1]}`;
}

/** «в Астане», «в Алматы», «в Караганде» — для вопроса. Несклоняемые оставляем как есть. */
export function cityIn(name: string): string {
  if (/[ыи]$/.test(name) || /[оеу]$/.test(name)) return name;          // Алматы, Актобе, Шу
  if (/а$/.test(name)) return name.slice(0, -1) + 'е';                // Астана → Астане
  if (/ь$/.test(name)) return name.slice(0, -1) + 'и';                // Сарань → Сарани
  if (/й$/.test(name)) return name.slice(0, -1) + 'е';                // Семей → Семее
  return name + 'е';                                                  // Шымкент → Шымкенте
}
