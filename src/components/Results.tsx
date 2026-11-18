import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { PRIORITY_LABEL, type Priority, type Result } from '../engine/recommend';
import { DESTINATIONS, ORIGINS, destToPlace } from '../data/places';
import { haversine, fmtDist } from '../engine/geo';
import { LotCard } from './LotCard';
import { Icon } from './Icon';

export const DURATIONS = [60, 120, 180, 240];

export function DurationPicker() {
  const d = useStore((s) => s.durationMin);
  const set = useStore((s) => s.setDuration);
  return (
    <div className="seg" role="radiogroup" aria-label="Сколько стоять">
      {DURATIONS.map((m) => (
        <button key={m} role="radio" aria-checked={d === m} className={d === m ? 'on' : ''} onClick={() => set(m)}>{m / 60} ч</button>
      ))}
    </div>
  );
}

export const ARRIVALS: (number | null)[] = [null, 5, 10, 15];

export function ArrivalPicker() {
  const v = useStore((s) => s.arriveIn);
  const set = useStore((s) => s.setArriveIn);
  return (
    <div className="seg" role="radiogroup" aria-label="Когда приедете">
      {ARRIVALS.map((m) => (
        <button key={String(m)} role="radio" aria-checked={v === m} className={v === m ? 'on' : ''} onClick={() => set(m)}>
          {m === null ? 'По маршруту' : `через ${m} мин`}
        </button>
      ))}
    </div>
  );
}

export function Results({ results }: { results: Result }) {
  const destination = useStore((s) => s.destination)!;
  const selectedId = useStore((s) => s.selectedLotId);
  const selectLot = useStore((s) => s.selectLot);
  const priority = useStore((s) => s.priority);
  const setPriority = useStore((s) => s.setPriority);
  const origin = useStore((s) => s.origin);
  const setOrigin = useStore((s) => s.setOrigin);
  const setDestination = useStore((s) => s.setDestination);
  const budget = useStore((s) => s.budget);
  const setBudget = useStore((s) => s.setBudget);
  const refs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (selectedId) refs.current.get(selectedId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedId]);

  const av = results.options.filter((o) => o.available);

  if (!results.options.length) {
    const nearest = [...DESTINATIONS].sort((a, b) => haversine(destination.lat, destination.lon, a.lat, a.lon) - haversine(destination.lat, destination.lon, b.lat, b.lon))[0];
    const dist = haversine(destination.lat, destination.lon, nearest.lat, nearest.lon);
    return (
      <div className="empty">
        <h2>Рядом с «{destination.name}» нет парковок в демо-базе</h2>
        <p>Искали в радиусе 1,5 км. Данные о местах пока есть для центра, Самала, Аль-Фараби, MEGA и Медеу.</p>
        <button className="btn btn--primary" onClick={() => setDestination(destToPlace(nearest))}>
          Показать ближайший район: {nearest.name}, {fmtDist(dist)}
        </button>
      </div>
    );
  }

  return (
    <div className="results">
      <div className="results__head">
        <h2>Парковки у «{destination.name}»</h2>
        <p className="demo-flag"><em className="src src--demo">демо</em> Места, цены, брони и прогноз — симуляция для показа. Ниже — реальные парковки из OSM.</p>
        <p className="muted">
          {av.length ? `${av.length} ${av.length === 1 ? 'вариант' : av.length < 5 ? 'варианта' : 'вариантов'} в ${fmtDist(results.radius)}` : 'Все парковки рядом сейчас недоступны'}
          {results.expanded && ' — рядом пусто, расширили поиск'}
          <label className="from">
            <span>, едете от</span>
            <select value={origin.id} onChange={(e) => setOrigin(ORIGINS.find((o) => o.id === e.target.value)!)} aria-label="Откуда едете">
              {ORIGINS.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
        </p>
      </div>
      {budget != null && (
        <div className="chips"><button className="chip chip--on" onClick={() => setBudget(null)}>{budget === 0 ? 'Только бесплатные' : `До ${budget} ₸ в час`} <Icon name="x" size={14} /></button></div>
      )}
      <div className="results__ctl">
        <ArrivalPicker />
        <DurationPicker />
        <div className="seg seg--soft" role="radiogroup" aria-label="Что важнее">
          {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => (
            <button key={p} role="radio" aria-checked={priority === p} className={priority === p ? 'on' : ''} onClick={() => setPriority(p)}>{PRIORITY_LABEL[p]}</button>
          ))}
        </div>
      </div>
      <div className="results__list">
        {results.options.map((o) => (
          <LotCard key={o.lot.id} o={o} selected={o.lot.id === selectedId}
            ref={(el) => { if (el) refs.current.set(o.lot.id, el); }}
            onClick={() => selectLot(o.lot.id)} />
        ))}
      </div>
      <p className="note">Демо: места и прогноз симулируются, ML-модель обучена на синтетической истории. Время в пути — оценка по средней скорости в этот час.</p>
    </div>
  );
}
