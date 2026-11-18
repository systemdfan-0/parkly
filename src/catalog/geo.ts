// Поиск города и места назначения по каталогу OSM + демо-ориентирам Алматы. Всё локально.
import { DESTINATIONS, STREETS, destToPlace, type Place } from '../data/places';
import { distM, type CatalogIndex, type City, type Poi } from './data';
import { GENERIC, fold, headMatch, phraseMatch, tokens } from './text';

/** Исторические и разговорные названия, которых нет в OSM у самого города. */
const EXTRA_ALIASES: Record<string, string[]> = {
  'Алматы': ['Алма-Ата', 'Алмата', 'Almaty', 'Алма Ата'],
  'Астана': ['Нур-Султан', 'Нурсултан', 'Акмола', 'Целиноград', 'Astana'],
  'Шымкент': ['Чимкент', 'Shymkent'],
  'Тараз': ['Джамбул', 'Жамбыл', 'Аулие-Ата'],
  'Усть-Каменогорск': ['Оскемен', 'Усть Каменогорск'],
  'Актау': ['Шевченко'],
  'Конаев': ['Капчагай', 'Капшагай'],
  'Кокшетау': ['Кокчетав'],
  'Костанай': ['Кустанай'],
  'Семей': ['Семипалатинск'],
  'Талдыкорган': ['Талдык'],
};

export const CAT_LABEL: Record<string, string> = {
  mall: 'ТРЦ', shop: 'Магазин', market: 'Рынок', theatre: 'Театр', cinema: 'Кинотеатр', culture: 'Культура', university: 'Вуз',
  hospital: 'Больница', station: 'Вокзал', gov: 'Госучреждение', worship: 'Храм', museum: 'Музей', attraction: 'Достопримечательность',
  hotel: 'Гостиница', stadium: 'Стадион', sport: 'Спорт', park: 'Парк', airport: 'Аэропорт', business: 'Бизнес-центр',
};
const CAT_BONUS: Record<string, number> = {
  mall: 6, airport: 6, theatre: 5, station: 5, stadium: 4, attraction: 4, market: 4, cinema: 3, culture: 3, museum: 3, university: 3,
  business: 2, hospital: 2, park: 2, sport: 2, hotel: 1, gov: 1, worship: 1, shop: -4,
};

export interface GeoHit {
  kind: 'city' | 'poi' | 'demo' | 'street';
  place: Place;
  city: City | null;
  score: number;
  hint: string;
  used: Set<number>;
}

interface Keyed<T> { item: T; keys: string[][] }
let cityKeys: Keyed<City>[] | null = null;
let cityKeysFor: CatalogIndex | null = null;
let poiKeys: Keyed<Poi>[] | null = null;
let poiKeysFor: Poi[] | null = null;
const demoKeys: Keyed<Place & { hint: string }>[] = [
  ...DESTINATIONS.map((d) => ({ item: { ...destToPlace(d), hint: d.blurb }, keys: [d.name, ...d.aliases].map(tokens) })),
  ...STREETS.map((s) => ({ item: { ...s, hint: 'Улица, Алматы' }, keys: [tokens(s.name)] })),
];

function citiesKeyed(ix: CatalogIndex) {
  if (cityKeys && cityKeysFor === ix) return cityKeys;
  cityKeysFor = ix;
  cityKeys = ix.cities.map((c) => ({
    item: c,
    keys: [c.ru, c.kk, c.en, ...c.alt, ...(EXTRA_ALIASES[c.ru] ?? [])].filter(Boolean).map(tokens).filter((k) => k.length && k.length <= 3),
  }));
  return cityKeys;
}
function poisKeyed(ps: Poi[]) {
  if (poiKeys && poiKeysFor === ps) return poiKeys;
  poiKeysFor = ps;
  poiKeys = ps.map((p) => ({ item: p, keys: [p.ru, p.kk, p.en, ...p.alt].filter(Boolean).map(tokens).filter((k) => k.length) }));
  return poiKeys;
}

const cityRank = (c: City) => (c.place === 'city' ? 2 : c.place === 'town' ? 1 : 0) + Math.min(2, c.lots / 200);
/** Крупные города узнаём и без предлога («Хан Шатыр Астана»); мелкие — только «в Абае», «г. Абай». */
export const isMajor = (c: City) => c.place === 'city' && c.lots >= 40;

export function cityPlace(c: City): Place {
  return { id: `city:${c.i}`, name: c.ru, address: c.kk && c.kk !== c.ru ? c.kk : 'Город', lat: c.lat, lon: c.lon, kind: 'city' };
}

/** Найти города в словах запроса. ctx — индексы слов, перед которыми стоит «в / г. / город». */
export function matchCities(ix: CatalogIndex, qw: string[], ctx: Set<number> = new Set(), typing = false): GeoHit[] {
  const out: GeoHit[] = [];
  for (const { item: c, keys } of citiesKeyed(ix)) {
    let best = 0, used = new Set<number>();
    for (const k of keys) {
      const m = phraseMatch(qw, k, typing);
      if (m.score > best) { best = m.score; used = m.used; }
    }
    if (best < 0.85) continue;
    const withCtx = [...used].some((i) => ctx.has(i));
    if (!typing && !withCtx && !isMajor(c) && qw.length > used.size) continue;
    out.push({ kind: 'city', place: cityPlace(c), city: c, score: best * 100 + cityRank(c) * 4 + (withCtx ? 10 : 0), hint: cityHint(ix, c), used });
  }
  return out.sort((a, b) => b.score - a.score);
}

export function cityHint(ix: CatalogIndex, c: City) {
  const reg = ix.regions[c.region];
  const where = reg && reg.ru !== c.ru ? reg.ru : 'город республиканского значения';
  return `${where} · в каталоге ${c.lots} ${c.lots % 10 === 1 && c.lots % 100 !== 11 ? 'парковка' : [2, 3, 4].includes(c.lots % 10) && ![12, 13, 14].includes(c.lots % 100) ? 'парковки' : 'парковок'}`;
}

export interface SearchOpts {
  city?: City | null;           // известный город (из запроса или текущей карты)
  near?: { lat: number; lon: number } | null;
  typing?: boolean;             // строка поиска: последнее слово дописывается
  strictCity?: boolean;         // город назван явно — места из других городов не предлагать
}

/** Поиск мест: демо-ориентиры Алматы, ориентиры OSM, улицы. Слова из used уже заняты (город, бюджет…). */
export function matchPlaces(ix: CatalogIndex, pois: Poi[] | null, qw: string[], opts: SearchOpts = {}, skip: Set<number> = new Set()): GeoHit[] {
  const words = qw.map((w, i) => (skip.has(i) ? '\u0000' : w));
  const real = words.filter((w) => w !== '\u0000').length;
  if (!real) return [];
  const out: GeoHit[] = [];
  // город назван в этой фразе — сильное условие; город из прошлого запроса — лёгкая подсказка
  const cityOk = (lat: number, lon: number, cityIdx: number) => {
    if (!opts.city) return 0;
    const inCity = cityIdx === opts.city.i || distM(lat, lon, opts.city.lat, opts.city.lon) < 25_000;
    if (opts.strictCity) return inCity ? 15 : -1000;
    return inCity ? 5 : 0;
  };
  const nearB = (lat: number, lon: number) => (opts.near && distM(lat, lon, opts.near.lat, opts.near.lon) < 30_000 ? 5 : 0);
  // доля слов запроса, которые «съело» название: «хан шатыра» → «Хан Шатыр» лучше, чем «Хан»
  const coverage = (best: number, used: Set<number>) => (opts.typing ? best * 100 * (used.size / real) : best * 80 + 20 * (used.size / real));

  const almaty = ix.cities.find((c) => c.ru === 'Алматы') ?? null;
  for (const { item, keys } of demoKeys) {
    let best = 0, used = new Set<number>();
    for (const k of keys) { const m = phraseMatch(words, k, opts.typing); if (m.score > best) { best = m.score; used = m.used; } }
    if (best < 0.8) continue;
    const s = coverage(best, used) + 8 + cityOk(item.lat, item.lon, almaty?.i ?? -1) + nearB(item.lat, item.lon) - (item.kind === 'street' ? 6 : 0);
    out.push({ kind: item.kind === 'street' ? 'street' : 'demo', place: item, city: almaty, score: s, hint: `${item.hint} · демо-парковки`, used });
  }
  if (pois) {
    for (const { item: p, keys } of poisKeyed(pois)) {
      let best = 0, used = new Set<number>();
      for (const k of keys) {
        const m = phraseMatch(words, k, opts.typing);
        if (m.score > best) { best = m.score; used = m.used; }
        // запрос из одного «бренда»: «мега» → «Mega Silk Way», «Мега Планет»
        if (best < 0.8) { const hi = headMatch(words, k); if (hi >= 0) { best = 0.8; used = new Set([hi]); } }
      }
      if (best < 0.8) continue;
      const c = p.city >= 0 ? ix.cities[p.city] : null;
      const s = coverage(best, used) + (CAT_BONUS[p.cat] ?? 0) + cityOk(p.lat, p.lon, p.city) + nearB(p.lat, p.lon);
      out.push({
        kind: 'poi', city: c, score: s, used,
        hint: `${CAT_LABEL[p.cat] ?? 'Место'}${c ? ', ' + c.ru : ''}`,
        place: { id: `poi:${p.i}`, name: p.ru, address: [p.kk && p.kk !== p.ru ? p.kk : '', c?.ru].filter(Boolean).join(' · '), lat: p.lat, lon: p.lon, kind: 'landmark' },
      });
    }
  }
  out.sort((a, b) => b.score - a.score);
  // одно и то же место в OSM бывает и точкой, и полигоном, плюс демо-ориентир рядом
  const uniq: GeoHit[] = [];
  for (const h of out) {
    if (uniq.some((u) => distM(u.place.lat, u.place.lon, h.place.lat, h.place.lon) < 400 && (fold(u.place.name) === fold(h.place.name) || h.kind === 'poi' && u.kind === 'demo'))) continue;
    uniq.push(h);
    if (uniq.length >= 12) break;
  }
  return uniq;
}

/**
 * Неоднозначность: несколько похожих совпадений в разных местах
 * («Мега» есть в Алматы, Астане и Шымкенте). Возвращает варианты для одного вопроса.
 */
export function ambiguous(hits: GeoHit[], rest: string[]): GeoHit[] | null {
  if (hits.length < 2) return null;
  const top = hits[0];
  const name = (h: GeoHit) => tokens(h.place.name);
  const head = (h: GeoHit) => name(h).find((w) => !GENERIC.has(w)) ?? '';
  const th = head(top);
  // запрос назвал больше одного слова названия («хан шатыра», «достык плазы») — он конкретный
  const specific = top.used.size >= 2 && name(top).filter((w) => rest.includes(w) || rest.some((q) => q.startsWith(w.slice(0, 4)))).length >= 2;
  const same = (h: GeoHit) => fold(h.place.name) === fold(top.place.name);
  const close = hits.filter((h) => h === top || (h.score >= top.score - (specific ? 15 : 20) && (specific ? same(h) : (!!th && head(h) === th) || h.score >= top.score - 4)));
  const far: GeoHit[] = [];
  for (const h of close) if (far.every((p) => distM(p.place.lat, p.place.lon, h.place.lat, h.place.lon) > 2_000)) far.push(h);
  return far.length >= 2 ? far.slice(0, 4) : null;
}

/** «вокзал», «рынок», «аэропорт» в известном городе — ищем по категории. */
export function byCategory(ix: CatalogIndex, pois: Poi[] | null, cat: string, city: City): GeoHit[] {
  if (!pois) return [];
  const cityKey = fold(city.ru);
  const out = pois.filter((p) => p.cat === cat && (p.city === city.i || distM(p.lat, p.lon, city.lat, city.lon) < 15_000))
    .map((p) => {
      const n = fold(p.ru);
      const s = (n.includes(cityKey) ? 20 : 0) + (/вокзал|аэропорт|центральн/.test(n) ? 15 : 0) - distM(p.lat, p.lon, city.lat, city.lon) / 2000;
      return { kind: 'poi' as const, city, score: 60 + s, used: new Set<number>(), hint: `${CAT_LABEL[p.cat] ?? 'Место'}, ${city.ru}`,
        place: { id: `poi:${p.i}`, name: n.includes(fold(CAT_LABEL[p.cat] ?? '')) ? p.ru : `${CAT_LABEL[p.cat] ?? 'Место'} «${p.ru}»`, address: city.ru, lat: p.lat, lon: p.lon, kind: 'landmark' as const } };
    })
    .sort((a, b) => b.score - a.score);
  const uniq: GeoHit[] = [];
  for (const h of out) { if (!uniq.some((u) => fold(u.place.name) === fold(h.place.name))) uniq.push(h); if (uniq.length >= 3) break; }
  return uniq;
}
