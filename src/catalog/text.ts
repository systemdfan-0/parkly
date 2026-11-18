// Нормализация и сопоставление названий: русский, казахский и латиница.
// «Хан Шатыра» ≈ «Хан Шатыр» ≈ «Khan Shatyr», «Қарағанды» ≈ «Караганда», «в Астане» ≈ «Астана».

const LAT2CYR: [RegExp, string][] = [
  [/c(?=[eiy])/g, 'с'], [/(?<=[^aeiouy\s])y(?=\s|$)/g, 'и'], [/shch/g, 'щ'], [/sh/g, 'ш'], [/ch/g, 'ч'], [/zh/g, 'ж'], [/ya/g, 'я'], [/yu/g, 'ю'], [/kh/g, 'х'], [/ts/g, 'ц'],
  [/a/g, 'а'], [/b/g, 'б'], [/c/g, 'к'], [/d/g, 'д'], [/e/g, 'е'], [/f/g, 'ф'], [/g/g, 'г'], [/h/g, 'х'], [/i/g, 'и'],
  [/j/g, 'ж'], [/k/g, 'к'], [/l/g, 'л'], [/m/g, 'м'], [/n/g, 'н'], [/o/g, 'о'], [/p/g, 'п'], [/q/g, 'к'], [/r/g, 'р'],
  [/s/g, 'с'], [/t/g, 'т'], [/u/g, 'у'], [/v/g, 'в'], [/w/g, 'в'], [/x/g, 'кс'], [/y/g, 'ы'], [/z/g, 'з'],
];

/** Нижний регистр, без ударений, казахские буквы → близкие русские, латиница → кириллица. */
export function fold(s: string): string {
  let t = s.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC').toLowerCase()
    .replace(/ё/g, 'е').replace(/ә/g, 'а').replace(/[ұү]/g, 'у').replace(/қ/g, 'к').replace(/ң/g, 'н')
    .replace(/ө/g, 'о').replace(/ғ/g, 'г').replace(/һ/g, 'х').replace(/і/g, 'и').replace(/й/g, 'и')
    .replace(/[äá]/g, 'a').replace(/[öó]/g, 'o').replace(/[üū]/g, 'u').replace(/ş/g, 'sh').replace(/ç/g, 'ch').replace(/ğ/g, 'g').replace(/ı/g, 'y').replace(/ñ/g, 'n');
  if (/[a-z]/.test(t)) t = LAT2CYR.reduce((acc, [re, r]) => acc.replace(re, r), t);
  return t.replace(/малл/g, 'молл').replace(/ъ|ь/g, '').replace(/[«»"'`’.,:;!?()/\\[\]{}+*№#—–-]/g, ' ').replace(/\s+/g, ' ').trim();
}

export const tokens = (s: string) => fold(s).split(' ').filter(Boolean);

/** Слова, которые есть почти в каждом названии и не различают места. */
export const GENERIC = new Set(['тц', 'трц', 'трк', 'бц', 'жк', 'ул', 'улица', 'пр', 'проспект', 'мкр', 'микрораион', 'торговыи', 'торговые',
  'центр', 'дом', 'магазин', 'супермаркет', 'гипермаркет', 'гостиница', 'отель', 'hotel', 'имени', 'им', 'парк', 'сквер', 'площадь',
  'и', 'г', 'город', 'каласы', 'аудан', 'раион', 'мечеть', 'церковь', 'храм', 'больница', 'поликлиника', 'вокзал', 'станция', 'стадион',
  'театр', 'кинотеатр', 'музеи', 'университет', 'колледж', 'рынок', 'базар', 'плаза', 'молл', 'мол', 'малл', 'mall']);

/** Общие слова, по которым можно искать категорию: «вокзал в Актобе», «рынок Шымкент». */
export const GENERIC_CAT: Record<string, string> = {
  вокзал: 'station', вокзала: 'station', жд: 'station', аэропорт: 'airport', аэропорта: 'airport', рынок: 'market', рынка: 'market', базар: 'market',
  базара: 'market', театр: 'theatre', театра: 'theatre', стадион: 'stadium', стадиона: 'stadium', университет: 'university', вуз: 'university',
  больница: 'hospital', больницы: 'hospital', кинотеатр: 'cinema', кино: 'cinema', музеи: 'museum', музея: 'museum', тц: 'mall', трц: 'mall', молл: 'mall',
};

function commonPrefix(a: string, b: string) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function lev1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, d = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++d > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return d + (a.length - i) + (b.length - j) <= 1;
}

/**
 * Насколько слово запроса q совпадает со словом названия k (0…1).
 * Учитывает падежные окончания («Шатыра», «Астане», «Плазы»), набор с начала слова и одну опечатку.
 */
export function wordMatch(q: string, k: string, typing = false): number {
  if (q === k) return 1;
  if (/^\d+$/.test(q) || /^\d+$/.test(k)) return 0;
  if (typing) {
    // слово ещё набирается: только совпадение с начала («Қараған» → «Караганда», но не «Карасу»)
    if (k.startsWith(q)) return q.length >= 3 ? 0.9 : 0.7;
    if (q.startsWith(k) && q.length - k.length <= 2 && k.length >= 3) return 0.85;
    return 0;
  }
  const p = commonPrefix(q, k);
  const m = Math.min(q.length, k.length);
  const M = Math.max(q.length, k.length);
  if (m >= 5 && p >= Math.max(4, m - 2) && p >= M - 3) return 0.88;              // склонение: «Шатыра», «Астане»
  if (m === 4 && p >= 3 && M <= 5) return 0.85;                                   // «Абая», «Мега» → «Меги»
  if (m === 3 && p === 3 && Math.abs(q.length - k.length) <= 1) return 0.8;      // «ЦУМа», «Хана»
  if (m >= 5 && lev1(q, k)) return 0.65;                                           // опечатка
  return 0;
}

/**
 * Совпадение фразы-названия с набором слов запроса.
 * Возвращает долю значимых слов названия, найденных в запросе, и какие слова запроса использованы.
 */
export function phraseMatch(qw: string[], key: string[], typing = false): { score: number; used: Set<number> } {
  const used = new Set<number>();
  let got = 0, total = 0, distinct = 0, distinctGot = 0;
  for (const k of key) {
    const w = GENERIC.has(k) ? 0.35 : 1;
    total += w;
    if (w === 1) distinct++;
    let best = 0, bi = -1;
    qw.forEach((q, i) => {
      if (used.has(i)) return;
      const s = wordMatch(q, k, typing && i === qw.length - 1);
      if (s > best) { best = s; bi = i; }
    });
    if (bi >= 0) { used.add(bi); got += best * w; if (w === 1) distinctGot++; }
  }
  if (!total || (distinct > 0 && distinctGot === 0)) return { score: 0, used: new Set() };
  // название только из общих слов («Plaza», «Сити») — слабое совпадение
  return { score: (got / total) * (distinct ? 1 : 0.85), used };
}

/** Совпадает ли первое значимое слово названия со словом запроса («мега» → «Mega Silk Way»). */
export function headMatch(qw: string[], key: string[]): number {
  const h = key.find((k) => !GENERIC.has(k));
  if (!h || key.length > 4) return -1;
  return qw.findIndex((q) => wordMatch(q, h) >= 0.85);
}
