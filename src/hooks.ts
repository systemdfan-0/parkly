import { useEffect, useMemo, useState } from 'react';
import { useStore } from './store';
import { recommend, buildOption, type Result, type Option } from './engine/recommend';
import { LOT_BY_ID, type Place } from './data/places';

export function useResults(): Result | null {
  const destination = useStore((s) => s.destination);
  const origin = useStore((s) => s.origin);
  const now = useStore((s) => s.sim.now);
  const occ = useStore((s) => s.sim.occ);
  const bookings = useStore((s) => s.bookings);
  const durationMin = useStore((s) => s.durationMin);
  const priority = useStore((s) => s.priority);
  const hist = useStore((s) => s.sim.hist);
  const arriveIn = useStore((s) => s.arriveIn);
  const budget = useStore((s) => s.budget);
  return useMemo(
    () => (destination && destination.kind !== 'city' ? recommend(destination, origin, now, durationMin, priority, occ, bookings, { hist, arriveIn, budget }) : null),
    [destination, origin, now, occ, bookings, durationMin, priority, hist, arriveIn, budget],
  );
}

/** Вариант для выбранной парковки: из результатов или отдельно (например, из избранного). */
export function useSelectedOption(results: Result | null): Option | null {
  const id = useStore((s) => s.selectedLotId);
  const destination = useStore((s) => s.destination);
  const origin = useStore((s) => s.origin);
  const now = useStore((s) => s.sim.now);
  const occ = useStore((s) => s.sim.occ);
  const bookings = useStore((s) => s.bookings);
  const durationMin = useStore((s) => s.durationMin);
  const hist = useStore((s) => s.sim.hist);
  const arriveIn = useStore((s) => s.arriveIn);
  return useMemo(() => {
    if (!id || !LOT_BY_ID[id]) return null;
    const found = results?.options.find((o) => o.lot.id === id);
    if (found) return found;
    const lot = LOT_BY_ID[id];
    const place: Place = destination ?? { id: 'lot:' + id, name: lot.name, address: '', lat: lot.lat, lon: lot.lon, kind: 'point' };
    return buildOption(lot, place, origin, now, durationMin, occ, bookings, { hist, arriveIn });
  }, [id, results, destination, origin, now, occ, bookings, durationMin, hist, arriveIn]);
}

export function useWide() {
  const q = '(min-width: 900px)';
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

/** Ход демо-времени: раз в секунду продвигаем симуляцию на speed секунд. */
export function useSimClock() {
  const speed = useStore((s) => s.sim.speed);
  const tick = useStore((s) => s.tick);
  useEffect(() => {
    if (!speed) return;
    const t = setInterval(() => tick(speed / 60), 1000);
    return () => clearInterval(t);
  }, [speed, tick]);
}
