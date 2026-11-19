// «Почему ИИ так решил»: настоящий путь в дереве решений, по которому модель посчитала прогноз.
import { useState } from 'react';
import type { Lot } from '../data/places';
import { explainAt, ML_HORIZONS } from '../ml/predict';
import { reservedAt, type Booking } from '../engine/model';
import { Icon } from './Icon';

interface Props { lot: Lot; now: number; driveMin: number; occNow: number; hist?: number[]; bookings: Booking[] }

export function WhyML({ lot, now, driveMin, occNow, hist, bookings }: Props) {
  const [open, setOpen] = useState(false);
  if (!hist || hist.length < 16) return null;
  const h = ML_HORIZONS.find((x) => x >= Math.min(driveMin, 15)) ?? 15;
  const res = reservedAt(lot.id, now, bookings);
  const free = (o: number) => Math.max(0, lot.capacity - o - res);
  const n = hist.length;
  const r = { now: free(occNow), m5: free(hist[n - 6]), m10: free(hist[n - 11]), m15: free(hist[n - 16]) };
  const e = explainAt(lot, now, r, h);
  const d = Math.round(e.delta);
  return (
    <div className="why">
      <button className="why__btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Icon name="info" size={16} /> {open ? 'Скрыть' : 'Почему ИИ так решил'}
      </button>
      {open && (
        <div className="why__body">
          <p className="small">Модель (дерево решений, прогноз на {h} мин) прошла {e.depth} проверок. Главные условия этой ситуации:</p>
          <ol className="why__steps">{e.steps.slice(0, 6).map((s) => <li key={s.feature}>{s.text}</li>)}</ol>
          <p className="small">В таких же ситуациях из истории свободных мест через {h} мин становилось <b>{d > 0 ? `больше на ${d}` : d < 0 ? `меньше на ${-d}` : 'столько же'}</b> — отсюда прогноз.</p>
          <p className="muted small">Это те же сравнения, что делает модель в телефоне, а не придуманный текст.</p>
        </div>
      )}
    </div>
  );
}
