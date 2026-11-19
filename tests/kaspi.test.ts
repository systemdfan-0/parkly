// Демо-оплата Kaspi: бронь с оплатой получает чек, отмена до приезда «возвращает» сумму; оплата на месте — без чека.
import { expect, test } from 'vitest';
import { useStore } from '../src/store';
import { LOTS } from '../src/data/places';
import { priceFor } from '../src/engine/pricing';
import { isOpenAt } from '../src/engine/model';

test('Kaspi (демо): чек, сумма, отмена возвращает', () => {
  useStore.getState().pinDemo();
  const s = useStore.getState();
  const now = s.sim.now, arriveAt = now + 10 * 60_000;
  const lot = LOTS.find((l) => l.bookable && isOpenAt(l, now) && priceFor(l, arriveAt, 120).total > 0)!;
  const b = s.book({ lotId: lot.id, destName: 'тест', arriveAt, durationMin: 120, pay: 'kaspi' });
  if (typeof b === 'string') throw new Error(b);
  expect(b.paid?.via).toBe('kaspi');
  expect(b.paid?.amount).toBe(b.price);
  expect(b.paid?.receipt).toMatch(/^PK-/);
  useStore.getState().cancelBooking(b.id);
  const c = useStore.getState().bookings.find((x) => x.id === b.id)!;
  expect(c.status).toBe('cancelled');
  expect(c.paid?.amount).toBe(0);

  const lot2 = LOTS.find((l) => l.id !== lot.id && l.bookable && isOpenAt(l, now) && priceFor(l, arriveAt, 120).total > 0)!;
  const d = useStore.getState().book({ lotId: lot2.id, destName: 'тест', arriveAt, durationMin: 120, pay: 'onsite' });
  if (typeof d === 'string') throw new Error(d);
  expect(d.paid).toBeUndefined();
});
