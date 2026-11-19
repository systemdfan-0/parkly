// Пилот на реальной парковке: замеры свободных мест из CSV.
// Поля: lot_id, observed_at, free, capacity. Строки с «#» — комментарии; слово «ТЕСТ» в комментарии помечает набор как тестовый.
// Модуль без зависимостей: его использует и приложение, и команда импорта (node scripts/import-measurements.ts).

export interface Obs { t: number; free: number }
export interface LotSeries { capacity: number; count: number; last: Obs; series: [number, number][] }
export interface Issue { line: number; msg: string }
export interface Parsed {
  test: boolean;
  rows: number;
  accepted: number;
  errors: Issue[];
  warnings: Issue[];
  lots: Record<string, LotSeries>;
}
export interface MeasurementsFile extends Omit<Parsed, 'errors' | 'warnings'> {
  source: string;
  file: string;
  importedAt: string;
  errors: Issue[];
  warnings: Issue[];
}

const COLS = ['lot_id', 'observed_at', 'free', 'capacity'] as const;
const LOT_RE = /^(osm:[nwr]\d+|[a-z0-9][a-z0-9-]{1,40})$/;
const GAP_MIN = 30;

function splitCsv(line: string): string[] {
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',' || ch === ';') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Время: ISO 8601 с поясом или «ГГГГ-ММ-ДД ЧЧ:ММ» (считаем время Казахстана, UTC+5). */
export function parseTime(s: string): number | null {
  if (!s) return null;
  const iso = /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:?\d\d)$/.test(s) ? s.replace(' ', 'T')
    : /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d(:\d\d)?$/.test(s) ? s.replace(' ', 'T') + '+05:00' : null;
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

export function parseMeasurements(text: string, now = Date.now()): Parsed {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const errors: Issue[] = [], warnings: Issue[] = [];
  let test = false, header: string[] | null = null, rows = 0;
  const seen = new Map<string, { free: number; capacity: number; line: number }>();
  const byLot = new Map<string, { t: number; free: number; capacity: number; line: number }[]>();

  lines.forEach((raw, i) => {
    const line = i + 1;
    const s = raw.trim();
    if (!s) return;
    if (s.startsWith('#')) { if (/ТЕСТ|TEST/i.test(s)) test = true; return; }
    const cells = splitCsv(s);
    if (!header) {
      header = cells.map((c) => c.toLowerCase());
      const miss = COLS.filter((c) => !header!.includes(c));
      if (miss.length) { errors.push({ line, msg: `В заголовке нет столбцов: ${miss.join(', ')}` }); header = null; }
      return;
    }
    rows++;
    const get = (c: typeof COLS[number]) => cells[header!.indexOf(c)] ?? '';
    const id = get('lot_id'), ts = get('observed_at'), fs = get('free'), cs = get('capacity');
    const empty = COLS.filter((c) => !get(c));
    if (empty.length) { errors.push({ line, msg: `Пропуск: нет значения ${empty.join(', ')}` }); return; }
    if (!LOT_RE.test(id)) { errors.push({ line, msg: `Неверный идентификатор парковки «${id}»` }); return; }
    const t = parseTime(ts);
    if (t == null) { errors.push({ line, msg: `Не время: «${ts}» (нужно 2026-11-19T18:20:00+05:00)` }); return; }
    if (t > now + 5 * 60_000) { errors.push({ line, msg: `Время в будущем: ${ts}` }); return; }
    if (t < Date.parse('2020-01-01T00:00:00Z')) { errors.push({ line, msg: `Слишком старое время: ${ts}` }); return; }
    if (!/^-?\d+$/.test(fs) || !/^-?\d+$/.test(cs)) { errors.push({ line, msg: `Не целое число: free=${fs}, capacity=${cs}` }); return; }
    const free = +fs, capacity = +cs;
    if (capacity <= 0 || capacity > 20000) { errors.push({ line, msg: `Невозможная вместимость: ${capacity}` }); return; }
    if (free < 0 || free > capacity) { errors.push({ line, msg: `Невозможное значение: свободно ${free} при вместимости ${capacity}` }); return; }
    const key = `${id}|${t}`;
    const dup = seen.get(key);
    if (dup) {
      if (dup.free === free && dup.capacity === capacity) warnings.push({ line, msg: `Дубликат строки ${dup.line} — пропущен` });
      else errors.push({ line, msg: `Конфликт со строкой ${dup.line}: тот же момент, другое значение (${dup.free} → ${free}) — оставлена первая` });
      return;
    }
    seen.set(key, { free, capacity, line });
    const arr = byLot.get(id) ?? [];
    arr.push({ t, free, capacity, line });
    byLot.set(id, arr);
  });
  if (!header && !errors.length) errors.push({ line: 1, msg: 'Файл пустой: нет заголовка lot_id,observed_at,free,capacity' });

  const lots: Record<string, LotSeries> = {};
  let accepted = 0;
  for (const [id, arr] of byLot) {
    arr.sort((a, b) => a.t - b.t);
    for (let k = 1; k < arr.length; k++) {
      const gap = (arr[k].t - arr[k - 1].t) / 60_000;
      if (gap > GAP_MIN) warnings.push({ line: arr[k].line, msg: `${id}: пропуск в замерах ${Math.round(gap)} мин` });
      if (arr[k].capacity !== arr[k - 1].capacity) warnings.push({ line: arr[k].line, msg: `${id}: вместимость изменилась ${arr[k - 1].capacity} → ${arr[k].capacity}` });
    }
    const last = arr[arr.length - 1];
    accepted += arr.length;
    lots[id] = { capacity: last.capacity, count: arr.length, last: { t: last.t, free: last.free }, series: arr.slice(-288).map((x) => [x.t, x.free]) };
  }
  return { test, rows, accepted, errors, warnings, lots };
}
