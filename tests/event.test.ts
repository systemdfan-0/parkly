// Демо «После мероприятия»: повторяемость, одинаковый поток в двух режимах, отмена освобождает ожидаемую ёмкость.
import { describe, expect, test } from 'vitest';
import { compareEvent, DEFAULT_EVENT, expectedBefore, makeDrivers, simulateEvent, eventLevels } from '../src/engine/event';

describe('«После мероприятия» (симуляция)', () => {
  test('повторный запуск с теми же настройками даёт тот же результат', () => {
    const a = compareEvent(DEFAULT_EVENT), b = compareEvent({ ...DEFAULT_EVENT });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  test('оба режима получают один и тот же поток водителей', () => {
    const { a, b } = compareEvent(DEFAULT_EVENT);
    const strip = (d: typeof a.drivers[number]) => [d.i, d.requestAt, d.drive, d.maxWalk, d.maxPrice, d.cancels];
    expect(b.drivers.map(strip)).toEqual(a.drivers.map(strip));
    expect(a.drivers.map(strip)).toEqual(makeDrivers(DEFAULT_EVENT).map(strip));
  });

  test('отменённый выбор освобождает ожидаемую ёмкость', () => {
    const claims = [{ lot: 'op-front', eta: 10, active: true }, { lot: 'op-front', eta: 12, active: true }, { lot: 'op-street', eta: 9, active: true }];
    expect(expectedBefore(claims, 'op-front', 15)).toBe(2);
    claims[0].active = false; // водитель отменил поездку
    expect(expectedBefore(claims, 'op-front', 15)).toBe(1);
    expect(expectedBefore(claims, 'op-front', 11)).toBe(0);
  });

  test('в новом режиме k считает только тех, кто ещё едет: отменившие и приехавшие не учитываются', () => {
    const b = simulateEvent({ ...DEFAULT_EVENT, cancelShare: 0.3 }, 'aware');
    const order = b.drivers; // уже в порядке решений
    let checked = 0, withCancel = 0;
    order.forEach((y, yi) => {
      for (const ev of y.evals) {
        const etaY = y.requestAt + y.drive;
        const k = order.slice(0, yi).filter((x) => x.choice?.lot === ev.lot && x.requestAt + x.drive <= etaY
          && !(x.cancels && x.requestAt + 3 <= y.requestAt) && !(!x.cancels && x.requestAt + x.drive <= y.requestAt)).length;
        expect(ev.k).toBe(k);
        checked++;
        if (order.slice(0, yi).some((x) => x.cancels && x.choice?.lot === ev.lot && x.requestAt + 3 <= y.requestAt && x.requestAt + x.drive <= etaY)) withCancel++;
      }
    });
    expect(checked).toBeGreaterThan(100);
    expect(withCancel).toBeGreaterThan(0); // были решения, где отмена реально уменьшила k
  });

  test('нагрузка: результаты по уровням посчитаны и честно разные', () => {
    const lv = eventLevels();
    expect(lv.map((x) => x.cars)).toEqual([20, 40, 80, 120, 160, 200]);
    for (const x of lv) {
      expect(x.a.chose).toBe(x.b.chose);
      expect(x.b.fullShare).toBeLessThanOrEqual(1);
    }
    // если подходящих нет (например, «только бесплатно»), это видно в результате
    expect(lv.some((x) => x.a.noOption > 0)).toBe(true);
    console.log(lv.map((x) => `${x.cars}: на полную ${(x.a.fullShare * 100).toFixed(0)}% → ${(x.b.fullShare * 100).toFixed(0)}%, пешком ${x.a.avgWalk.toFixed(1)} → ${x.b.avgWalk.toFixed(1)}, без варианта ${x.a.noOption}, не нашли место ${x.a.leftArea} → ${x.b.leftArea}`).join('\n'));
  });

  test('Пин объясняет изменившуюся рекомендацию числами', () => {
    const c = compareEvent(DEFAULT_EVENT);
    expect(c.pin).toMatch(/уже едут \d+ машин[аы]? из Parkly, и шанс падает с \d+% до \d+%/);
  });
});
