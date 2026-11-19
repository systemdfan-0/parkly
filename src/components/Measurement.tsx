// Пилот: последний реальный замер свободных мест (public/pilot/measurements.json, импорт — npm run pilot:import).
import { useEffect, useState } from 'react';
import type { MeasurementsFile } from '../pilot/measurements';
import { Icon } from './Icon';

let cache: Promise<MeasurementsFile | null> | null = null;
export function loadMeasurements(): Promise<MeasurementsFile | null> {
  cache ??= fetch('./pilot/measurements.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return cache;
}

const fmt = (t: number) => new Date(t).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export function MeasurementLine({ lotId }: { lotId: string }) {
  const [m, setM] = useState<MeasurementsFile | null>(null);
  useEffect(() => { void loadMeasurements().then(setM); }, []);
  const s = m?.lots[lotId];
  if (!m || !s) return null;
  const ageMin = Math.round((Date.now() - s.last.t) / 60_000);
  return (
    <div className={`banner ${m.test ? 'banner--warn' : 'banner--ok'} measure`} role="note">
      <Icon name="info" size={18} />
      <span>
        <b>Замер пилота: свободно {s.last.free} из {s.capacity}</b> — {fmt(s.last.t)}{ageMin > 30 ? ` (${ageMin > 1440 ? 'больше суток назад' : `${ageMin} мин назад`})` : ''}.
        <br />Источник: {m.source}{m.test ? ' · ТЕСТОВЫЕ ДАННЫЕ, не реальные замеры' : ''}. Замеров: {s.count}. Прогноз выше по-прежнему считает модель демо.
      </span>
    </div>
  );
}
