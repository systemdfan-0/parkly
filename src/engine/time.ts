// Время в приложении — «демо-часы Алматы» (UTC+5), не зависят от часового пояса телефона.
export const MIN = 60_000;
const OFFSET = 5 * 60 * MIN;

export interface Parts { y: number; mo: number; d: number; dow: number; h: number; m: number; minOfDay: number }

export function parts(ms: number): Parts {
  const t = new Date(ms + OFFSET);
  const h = t.getUTCHours();
  const m = t.getUTCMinutes();
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth(), d: t.getUTCDate(), dow: t.getUTCDay(), h, m, minOfDay: h * 60 + m + t.getUTCSeconds() / 60 };
}

export function isWeekend(ms: number) {
  const { dow } = parts(ms);
  return dow === 0 || dow === 6;
}

export function almatyMs(y: number, mo: number, d: number, h: number, m: number) {
  return Date.UTC(y, mo, d, h, m) - OFFSET;
}

const pad = (n: number) => String(n).padStart(2, '0');
export function fmtTime(ms: number) {
  const p = parts(ms);
  return `${p.h}:${pad(p.m)}`;
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const DOW = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const DOW_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

export function fmtDate(ms: number) {
  const p = parts(ms);
  return `${p.d} ${MONTHS[p.mo]}`;
}
export function fmtDow(ms: number, full = false) {
  return (full ? DOW_FULL : DOW)[parts(ms).dow];
}
export function fmtDur(min: number) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (!h) return `${m} мин`;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}
export function sameDay(a: number, b: number) {
  const x = parts(a), y = parts(b);
  return x.y === y.y && x.mo === y.mo && x.d === y.d;
}
