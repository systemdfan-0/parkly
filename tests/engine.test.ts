import { describe, expect, test, beforeEach } from 'vitest';
import { LOTS, LOT_BY_ID, ORIGINS, DESTINATIONS, destToPlace } from '../src/data/places';
import { forecast, freeNow, stepOcc, reservedAt, isOpenAt, type Rng } from '../src/engine/model';
import { priceFor } from '../src/engine/pricing';
import { recommend } from '../src/engine/recommend';
import { searchLocal } from '../src/engine/search';
import { SCENARIOS, scenarioStart, initialOccupancy } from '../src/engine/scenarios';
import { MIN } from '../src/engine/time';
import { useStore, selectFree } from '../src/store';
import { initialHistory } from '../src/engine/scenarios';
import { pinAnswer, pinChange } from '../src/engine/pin';
import { predictML, predictAt } from '../src/ml/predict';

const REAL = Date.UTC(2026, 10, 18, 10); // ср, 18 ноября 2026
const evening = scenarioStart(SCENARIOS.find((s) => s.id === 'evening')!, REAL);

describe('бронирование, отмена и симуляция согласованы', () => {
  beforeEach(() => { useStore.getState().resetDemo(); useStore.getState().setSpeed(0); });

  test('бронь занимает место, отмена возвращает', () => {
    const s0 = useStore.getState();
    const before = selectFree(s0, 'dp-office');
    expect(before).toBeGreaterThan(0);
    const b = s0.book({ lotId: 'dp-office', destName: 'Dostyk Plaza', arriveAt: s0.sim.now + 11 * MIN, durationMin: 120 });
    expect(typeof b).toBe('object');
    expect(selectFree(useStore.getState(), 'dp-office')).toBe(before - 1);
    // повторная бронь на ту же парковку запрещена
    expect(typeof useStore.getState().book({ lotId: 'dp-office', destName: 'x', arriveAt: s0.sim.now, durationMin: 60 })).toBe('string');
    useStore.getState().cancelBooking((b as { id: string }).id);
    expect(selectFree(useStore.getState(), 'dp-office')).toBe(before);
    expect(useStore.getState().bookings[0].status).toBe('cancelled');
  });

  test('на заполненной парковке бронь невозможна; уличная зона без брони', () => {
    const st = useStore.getState();
    st.demoFill('dp-under');
    expect(selectFree(useStore.getState(), 'dp-under')).toBe(0);
    expect(typeof useStore.getState().book({ lotId: 'dp-under', destName: 'x', arriveAt: st.sim.now + 12 * MIN, durationMin: 60 })).toBe('string');
    expect(typeof useStore.getState().book({ lotId: 'dp-street', destName: 'x', arriveAt: st.sim.now + 10 * MIN, durationMin: 60 })).toBe('string');
  });

  test('симуляция не превышает ёмкость с учётом броней, бронь освобождается по окончании', () => {
    const st = useStore.getState();
    const b = st.book({ lotId: 'dp-surface', destName: 'x', arriveAt: st.sim.now + 13 * MIN, durationMin: 60 }) as { endAt: number };
    for (let i = 0; i < 120; i++) {
      useStore.getState().jump(1);
      const s = useStore.getState();
      for (const lot of LOTS) {
        const occ = s.sim.occ[lot.id];
        expect(occ).toBeGreaterThanOrEqual(0);
        expect(occ + reservedAt(lot.id, s.sim.now, s.bookings)).toBeLessThanOrEqual(lot.capacity);
      }
    }
    const s = useStore.getState();
    expect(s.sim.now).toBeGreaterThan(b.endAt);
    expect(s.bookings.find((x) => x.lotId === 'dp-surface')!.status).toBe('completed');
    expect(reservedAt('dp-surface', s.sim.now, s.bookings)).toBe(0);
  });

  test('уведомление: 0 мест → место освободилось', () => {
    const st = useStore.getState();
    st.demoFill('dp-under');
    useStore.getState().toggleWatch('dp-under');
    useStore.getState().demoRelease('dp-under', 3);
    const n = useStore.getState().notices.at(-1)!;
    expect(n.kind).toBe('spot');
    expect(n.lotId).toBe('dp-under');
  });
});

describe('прогноз', () => {
  test('калиброван: факт попадает в 60%-й диапазон примерно в 60% случаев', () => {
    let inside = 0, total = 0;
    const occ0 = initialOccupancy(evening);
    for (const lot of LOTS.filter((l) => isOpenAt(l, evening) && l.capacity >= 40)) {
      const fc = forecast(lot, occ0[lot.id], evening, 15, []);
      for (let k = 0; k < 40; k++) {
        const r: Rng = { s: 1000 + k * 7919 + lot.capacity };
        let occ = occ0[lot.id];
        for (let m = 0; m < 15; m++) occ = stepOcc(lot, occ, 0, evening + m * MIN, 1, r);
        const f = freeNow(lot, occ, evening + 15 * MIN, []);
        total++; if (f >= fc.lo && f <= fc.hi) inside++;
      }
    }
    const cover = inside / total;
    expect(cover).toBeGreaterThan(0.5);
    expect(cover).toBeLessThan(0.95);
  });

  test('офис вечером освобождается, театр перед спектаклем заполняется', () => {
    const occ = initialOccupancy(evening);
    const office = forecast(LOT_BY_ID['dp-office'], occ['dp-office'], evening, 15, []);
    expect(office.mid).toBeGreaterThan(freeNow(LOT_BY_ID['dp-office'], occ['dp-office'], evening, []));
    const th = forecast(LOT_BY_ID['op-front'], occ['op-front'], evening, 15, []);
    expect(th.mid).toBeLessThan(freeNow(LOT_BY_ID['op-front'], occ['op-front'], evening, []));
  });
});

describe('подбор', () => {
  test('Dostyk Plaza вечером: разные парковки — лучший, ближе, дешевле, надёжнее', () => {
    const r = recommend(destToPlace(DESTINATIONS[0]), ORIGINS[0], evening, 120, 'balanced', initialOccupancy(evening), []);
    const byTag = (t: string) => r.options.find((o) => o.tags.includes(t as never))!.lot.id;
    expect(byTag('best')).toBe('dp-office');
    expect(byTag('closest')).toBe('dp-under');
    expect(byTag('cheapest')).toBe('dp-street');
    expect(byTag('reliable')).toBe('dp-res');
    for (const o of r.options) expect(o.reason.length).toBeGreaterThan(10);
  });

  test('рынок после 19:00 недоступен, P2 у Esentai закрыта', () => {
    const occ = initialOccupancy(evening);
    const gb = recommend(destToPlace(DESTINATIONS.find((d) => d.id === 'green-bazaar')!), ORIGINS[0], evening, 120, 'balanced', occ, []);
    expect(gb.options.find((o) => o.lot.id === 'gb-main')!.available).toBe(false);
    const es = recommend(destToPlace(DESTINATIONS.find((d) => d.id === 'esentai')!), ORIGINS[0], evening, 120, 'balanced', occ, []);
    expect(es.options.find((o) => o.lot.id === 'es-p2')!.available).toBe(false);
  });

  test('точка без парковок рядом даёт пустой результат', () => {
    const r = recommend({ id: 'x', name: 'Алатау', address: '', lat: 43.30, lon: 76.80, kind: 'point' }, ORIGINS[0], evening, 120, 'balanced', initialOccupancy(evening), []);
    expect(r.options).toHaveLength(0);
  });
});

describe('цена и поиск', () => {
  test('улица бесплатна после 20:00, первые 30 мин в ТРЦ бесплатно', () => {
    expect(priceFor(LOT_BY_ID['dp-street'], evening + 15 * MIN, 120).total).toBe(225); // 18:40–20:00 платно
    expect(priceFor(LOT_BY_ID['dp-under'], evening, 30).total).toBe(0);
    expect(priceFor(LOT_BY_ID['dp-under'], evening, 120).total).toBe(600);
    expect(priceFor(LOT_BY_ID['a2-long'], evening, 24 * 60).total).toBe(2500);
  });

  test('поиск по ориентирам, транслиту, казахскому и адресу', () => {
    expect(searchLocal('Достык Плаза')[0].place.id).toBe('dostyk-plaza');
    expect(searchLocal('dostyk')[0].place.id).toBe('dostyk-plaza');
    expect(searchLocal('көк базар')[0].place.id).toBe('green-bazaar');
    expect(searchLocal('Абая 44')[0].place.name).toBe('пр. Абая');
    expect(searchLocal('ул. Жолдасбекова').length).toBeGreaterThan(0);
    expect(searchLocal('Хогвартс')).toHaveLength(0);
  });
});

describe('ML-прогноз и Пин', () => {
  const place = destToPlace(DESTINATIONS.find((d) => d.id === 'opera')!);
  const occ = initialOccupancy(evening), hist = initialHistory(evening);

  test('до 15 минут — модель, дальше — эвристика', () => {
    const r5 = recommend(place, ORIGINS[0], evening, 120, 'balanced', occ, [], { hist, arriveIn: 5 });
    expect(r5.options.every((o) => !o.available || o.fcSource === 'ml')).toBe(true);
    const r30 = recommend(place, ORIGINS[0], evening, 120, 'balanced', occ, [], { hist, arriveIn: 30 });
    expect(r30.options.every((o) => o.fcSource === 'heuristic')).toBe(true);
    expect(predictML(LOT_BY_ID['op-front'], evening, { now: 5, m5: 7, m10: 9, m15: 11 }, 16)).toBeNull();
  });

  test('модель работает без сети: только встроенный JSON, результат детерминирован', () => {
    const a = predictAt(LOT_BY_ID['dp-under'], evening, { now: 2, m5: 4, m10: 6, m15: 8 }, 10).band;
    const b = predictAt(LOT_BY_ID['dp-under'], evening, { now: 2, m5: 4, m10: 6, m15: 8 }, 10).band;
    expect(a).toEqual(b);
    expect(a.lo).toBeGreaterThanOrEqual(0);
    expect(a.hi).toBeLessThanOrEqual(450);
  });

  test('сценарий защиты: «через 5 мин» → у театра, «через 15 мин» → другая парковка с объяснением', () => {
    const r5 = recommend(place, ORIGINS[0], evening, 120, 'balanced', occ, [], { hist, arriveIn: 5 });
    const r15 = recommend(place, ORIGINS[0], evening, 120, 'balanced', occ, [], { hist, arriveIn: 15 });
    const a5 = pinAnswer(r5, 'balanced')!, a15 = pinAnswer(r15, 'balanced')!;
    expect(a5.best.lot.id).toBe('op-front');
    expect(a15.best.lot.id).not.toBe('op-front');
    const theatre15 = r15.options.find((o) => o.lot.id === 'op-front')!;
    expect(theatre15.fc.pFree).toBeLessThan(a5.best.fc.pFree);
    const why = pinChange(a5.best, 'При приезде через 5 мин', r15, 'Через 15 мин')!;
    expect(why).toContain('У театра');
    expect(why).toContain('спектакл');
    expect(a15.backupText).toBeTruthy();
    for (const f of a15.facts) expect(f.text.length).toBeGreaterThan(3);
  });
});
