import { DESTINATIONS, STREETS, destToPlace, type Place } from '../data/places';

const LAT2CYR: [RegExp, string][] = [
  [/sh/g, 'ш'], [/ch/g, 'ч'], [/zh/g, 'ж'], [/ya/g, 'я'], [/yu/g, 'ю'], [/kh/g, 'х'],
  [/a/g, 'а'], [/b/g, 'б'], [/c/g, 'к'], [/d/g, 'д'], [/e/g, 'е'], [/f/g, 'ф'], [/g/g, 'г'], [/h/g, 'х'], [/i/g, 'и'],
  [/j/g, 'ж'], [/k/g, 'к'], [/l/g, 'л'], [/m/g, 'м'], [/n/g, 'н'], [/o/g, 'о'], [/p/g, 'п'], [/q/g, 'к'], [/r/g, 'р'],
  [/s/g, 'с'], [/t/g, 'т'], [/u/g, 'у'], [/v/g, 'в'], [/w/g, 'в'], [/x/g, 'кс'], [/y/g, 'ы'], [/z/g, 'з'],
];

export function norm(s: string): string {
  return s.toLowerCase()
    .replace(/ё/g, 'е').replace(/[әа]/g, 'а').replace(/[ұүу]/g, 'у').replace(/[қк]/g, 'к').replace(/[ңн]/g, 'н')
    .replace(/[өо]/g, 'о').replace(/[ғг]/g, 'г').replace(/[һх]/g, 'х').replace(/і/g, 'и')
    .replace(/[«»"'.,()/\\-]/g, ' ')
    .replace(/(^|\s)(ул|улица|пр|проспект|мкр|микрорайон|трц|тц|тд)(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
const translit = (s: string) => LAT2CYR.reduce((acc, [re, r]) => acc.replace(re, r), s);

interface Indexed { place: Place; keys: string[]; hint: string }

const INDEX: Indexed[] = [
  ...DESTINATIONS.map((d) => ({ place: destToPlace(d), keys: [d.name, d.address, ...d.aliases].map(norm), hint: d.blurb })),
  ...STREETS.map((s) => ({ place: s, keys: [norm(s.name)], hint: 'Улица' })),
];

function scoreKey(q: string, key: string): number {
  if (!q) return 0;
  if (key === q) return 100;
  if (key.startsWith(q)) return 80;
  if (key.split(' ').some((w) => w.startsWith(q))) return 65;
  if (key.includes(q)) return 50;
  const qw = q.split(' ').filter((w) => w.length > 1);
  if (qw.length && qw.every((w) => key.includes(w))) return 45;
  // опечатка в одно-два символа
  if (q.length >= 4) {
    for (const w of key.split(' ')) if (w.length >= 4 && lev(q, w.slice(0, q.length + 1)) <= (q.length > 6 ? 2 : 1)) return 30;
  }
  return 0;
}

function lev(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

export interface Suggestion { place: Place; hint: string; score: number }

export function searchLocal(query: string): Suggestion[] {
  const q = norm(query);
  if (!q) return [];
  const qs = /[a-z]/.test(q) ? [q, norm(translit(q))] : [q];
  const res: Suggestion[] = [];
  for (const it of INDEX) {
    let best = 0;
    for (const qq of qs) for (const k of it.keys) best = Math.max(best, scoreKey(qq, k));
    // номер дома после названия улицы: «Абая 44»
    if (!best && it.place.kind === 'street') {
      const words = q.replace(/\d+\w*/g, '').trim();
      if (words.length >= 3) for (const k of it.keys) best = Math.max(best, scoreKey(words, k) - 10);
    }
    if (best > 0) res.push({ place: it.place, hint: it.hint, score: best + (it.place.kind === 'landmark' ? 5 : 0) });
  }
  return res.sort((a, b) => b.score - a.score).slice(0, 6);
}

/** Поиск адреса в OpenStreetMap (Nominatim) по Казахстану — только по явной кнопке, без ключей. */
export async function searchOnline(query: string, signal?: AbortSignal): Promise<Place[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=ru&countrycodes=kz&q=${encodeURIComponent(query)}`;
  const r = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('Сервис адресов не ответил');
  const data = (await r.json()) as { place_id: number; display_name: string; lat: string; lon: string; name?: string }[];
  return data.map((d) => {
    const parts = d.display_name.split(',').map((x) => x.trim());
    return { id: 'osm:' + d.place_id, name: d.name || parts.slice(0, 2).join(', '), address: parts.slice(0, 4).join(', '),
      lat: +d.lat, lon: +d.lon, kind: 'address' as const };
  });
}
