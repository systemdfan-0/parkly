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

test('отмена на «Оплачиваю…»: таймер гаснет, брони и чека нет', async () => {
  const { vi } = await import('vitest');
  const { startPayment, PAY_MS } = await import('../src/engine/payment');
  vi.useFakeTimers();
  try {
    useStore.getState().pinDemo();
    const s = useStore.getState(), now = s.sim.now, arriveAt = now + 10 * 60_000;
    const lot = LOTS.find((l) => l.bookable && isOpenAt(l, now) && priceFor(l, arriveAt, 120).total > 0)!;
    const before = useStore.getState().bookings.filter((b) => b.status === 'active').length;
    const book = () => useStore.getState().book({ lotId: lot.id, destName: 'тест', arriveAt, durationMin: 120, pay: 'kaspi' });
    const a = startPayment(book);
    vi.advanceTimersByTime(300);
    expect(a.cancel()).toBe(true);          // «Назад» сразу после «Оплатить»
    vi.advanceTimersByTime(2000);           // ждём дольше, чем шла бы оплата
    expect(a.state).toBe('cancelled');
    expect(useStore.getState().bookings.filter((b) => b.status === 'active').length).toBe(before);
    // без отмены — бронь с чеком появляется
    const ok = startPayment(book);
    vi.advanceTimersByTime(PAY_MS);
    expect(ok.state).toBe('paid');
    expect(ok.cancel()).toBe(false);
    expect(useStore.getState().bookings.find((b) => b.lotId === lot.id && b.status === 'active')?.paid?.receipt).toMatch(/^PK-[A-Z0-9]{4}\d{3}$/);
  } finally { vi.useRealTimers(); }
});
