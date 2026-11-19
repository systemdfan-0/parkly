import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseMeasurements } from '../src/pilot/measurements';
import { useCar } from '../src/car/store';
import { navLink } from '../src/nav';

const NOW = Date.parse('2026-11-19T12:00:00+05:00');

describe('пилот: импорт замеров из CSV', () => {
  test('тестовый набор помечен, ошибки найдены, последний замер — правильный', () => {
    const p = parseMeasurements(readFileSync('data/pilot/test-measurements.csv', 'utf8'), NOW);
    expect(p.test).toBe(true);
    expect(p.accepted).toBe(8);
    const msgs = p.errors.map((e) => e.msg).join('\n');
    expect(msgs).toMatch(/Пропуск: нет значения free/);
    expect(msgs).toMatch(/Невозможное значение: свободно 500 при вместимости 450/);
    expect(msgs).toMatch(/Конфликт со строкой/);
    expect(msgs).toMatch(/Не время/);
    expect(p.warnings.map((w) => w.msg).join('\n')).toMatch(/Дубликат.*\n?.*|пропуск в замерах 55 мин/);
    expect(p.lots['dp-under'].last.free).toBe(53);
    expect(p.lots['dp-under'].capacity).toBe(450);
  });
  test('заголовок без нужных столбцов и будущее время — ошибки, а не тихий импорт', () => {
    expect(parseMeasurements('id,time\nx,1', NOW).errors[0].msg).toMatch(/нет столбцов: lot_id, observed_at, free, capacity/);
    const p = parseMeasurements('lot_id,observed_at,free,capacity\nosm:w1,2026-11-20T10:00:00+05:00,3,10\nosm:w1,2026-11-19T10:00:00+05:00,-1,10', NOW);
    expect(p.accepted).toBe(0);
    expect(p.errors.map((e) => e.msg).join(' ')).toMatch(/будущем.*Невозможное значение/);
  });
});

describe('«Где моя машина»', () => {
  test('сохраняется с заметкой, правится вручную на карте, удаляется', () => {
    useCar.getState().save({ lat: 43.2, lon: 76.9, how: 'lot', note: '  −2 этаж, ряд B ', lotName: 'Подземный ТРЦ', lotId: 'dp-under' });
    expect(useCar.getState().car).toMatchObject({ note: '−2 этаж, ряд B', how: 'lot' });
    // запись в localStorage — переживёт перезапуск
    expect(localStorage.getItem('parkly-car')).toContain('ряд B');
    useCar.getState().setPicking(true);
    useCar.getState().pick(43.21, 76.91);
    expect(useCar.getState().car).toMatchObject({ lat: 43.21, how: 'map', note: '−2 этаж, ряд B' });
    expect(useCar.getState().picking).toBe(false);
    // точку сдвинули далеко (~1,4 км) — это уже не «Подземный ТРЦ», название парковки не тянется за точкой
    expect(useCar.getState().car?.lotName).toBeUndefined();
    expect(useCar.getState().car?.lotId).toBeUndefined();
    // а небольшая поправка внутри той же парковки (~50 м) название сохраняет
    useCar.getState().save({ lat: 43.2, lon: 76.9, how: 'lot', note: 'ряд B', lotName: 'Подземный ТРЦ', lotId: 'dp-under' });
    useCar.getState().pick(43.2004, 76.9002);
    expect(useCar.getState().car).toMatchObject({ how: 'map', lotName: 'Подземный ТРЦ', lotId: 'dp-under' });
    useCar.getState().remove();
    expect(useCar.getState().car).toBeNull();
    expect(localStorage.getItem('parkly-car')).not.toContain('ряд B');
  });
});

describe('навигатор: «Ко въезду» / «К парковке»', () => {
  test('есть въезд — ведём к нему; нет — к парковке', () => {
    const a = navLink({ lat: 1, lon: 2, entr: [1.001, 2.002], label: 'P' });
    expect(a.text).toBe('Ко въезду');
    expect(a.href).toContain('1.001');
    const b = navLink({ lat: 1, lon: 2, entr: null, label: 'P' });
    expect(b.text).toBe('К парковке');
    expect(b.href).toContain('1,2');
  });
});
