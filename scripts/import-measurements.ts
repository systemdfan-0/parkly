// Импорт замеров пилота из CSV → public/pilot/measurements.json (его показывает приложение).
//   npm run pilot:import -- data/pilot/test-measurements.csv --source "Тестовый набор"
// Проверяет пропуски, дубликаты и невозможные значения; печатает отчёт. Без принятых строк — код выхода 1.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename } from 'node:path';
import { parseMeasurements, type MeasurementsFile } from '../src/pilot/measurements.ts';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const si = args.indexOf('--source');
const source = si >= 0 ? args[si + 1] : '';
if (!file || !source) {
  console.error('Использование: npm run pilot:import -- <файл.csv> --source "кто и как мерил"');
  process.exit(2);
}
const p = parseMeasurements(readFileSync(file, 'utf8'));
const out: MeasurementsFile = { ...p, source, file: basename(file), importedAt: new Date().toISOString(), errors: p.errors.slice(0, 100), warnings: p.warnings.slice(0, 100) };
const fmt = (t: number) => new Date(t).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' });

console.log(`${file}: строк ${p.rows}, принято ${p.accepted}, ошибок ${p.errors.length}, предупреждений ${p.warnings.length}${p.test ? ' — ТЕСТОВЫЙ НАБОР' : ''}`);
for (const e of p.errors) console.log(`  ошибка, строка ${e.line}: ${e.msg}`);
for (const w of p.warnings) console.log(`  внимание, строка ${w.line}: ${w.msg}`);
for (const [id, l] of Object.entries(p.lots)) console.log(`  ${id}: ${l.count} замеров, последний ${fmt(l.last.t)} — свободно ${l.last.free} из ${l.capacity}`);
if (!p.accepted) { console.error('Нет ни одной корректной строки — файл не записан.'); process.exit(1); }
mkdirSync('public/pilot', { recursive: true });
writeFileSync('public/pilot/measurements.json', JSON.stringify(out, null, 1) + '\n');
console.log('→ public/pilot/measurements.json');
