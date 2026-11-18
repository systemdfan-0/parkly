import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { DESTINATIONS, destToPlace } from '../data/places';
import { SCENARIOS } from '../engine/scenarios';
import { fmtDow } from '../engine/time';
import { indexSync, loadIndex, type CatalogIndex } from '../catalog/data';
import { cityPlace } from '../catalog/geo';

const QUICK = ['dostyk-plaza', 'esentai', 'mega', 'green-bazaar', 'opera', 'arbat'];
const CITIES = ['Астана', 'Шымкент', 'Караганда', 'Актобе', 'Атырау', 'Усть-Каменогорск', 'Павлодар', 'Костанай'];
const n = (x: number) => x.toLocaleString('ru-RU').replace(/,/g, ' ');

export function Home({ onDemo, onCoverage, onAsk }: { onDemo: () => void; onCoverage: () => void; onAsk: () => void }) {
  const setDestination = useStore((s) => s.setDestination);
  const recent = useStore((s) => s.recent);
  const now = useStore((s) => s.sim.now);
  const scenarioId = useStore((s) => s.sim.scenarioId);
  const sc = SCENARIOS.find((s) => s.id === scenarioId);
  const [ix, setIx] = useState<CatalogIndex | null>(indexSync());
  useEffect(() => { if (!ix) loadIndex().then(setIx, () => {}); }, [ix]);
  return (
    <div className="home">
      <h1 className="slogan">Меньше кругов по городу — больше времени на жизнь</h1>
      <p className="home__lead">Скажите, куда едете, или <button className="link" onClick={onAsk}>напишите Пину</button> своими словами.</p>
      <div className="home__group">
        <small className="muted">Алматы — демо с прогнозом мест и бронью</small>
        <div className="chips" aria-label="Популярные места Алматы">
          {QUICK.map((id) => {
            const d = DESTINATIONS.find((x) => x.id === id)!;
            return <button key={id} className="chip" onClick={() => setDestination(destToPlace(d))}>{d.name}</button>;
          })}
        </div>
      </div>
      {ix && (
        <div className="home__group">
          <small className="muted">Другие города — каталог OpenStreetMap</small>
          <div className="chips" aria-label="Города">
            {CITIES.map((name) => {
              const c = ix.cities.filter((x) => x.ru === name).sort((a, b) => b.lots - a.lots)[0];
              return c ? <button key={name} className="chip chip--ghost" onClick={() => setDestination(cityPlace(c))}>{c.ru} <span className="muted">{n(c.lots)}</span></button> : null;
            })}
          </div>
          <button className="demo-note demo-note--cat" onClick={onCoverage}>
            <b>Каталог: {n(ix.stats.lots)} парковок в {n(ix.cities.filter((c) => c.lots).length)} населённых пунктах.</b>
            <span>Покрытие по областям и городам, источник и дата выгрузки</span>
          </button>
        </div>
      )}
      {recent.length > 0 && (
        <div className="home__group">
          <small className="muted">Недавние</small>
          <div className="chips">{recent.slice(0, 3).map((p) => <button key={p.id} className="chip chip--ghost" onClick={() => setDestination(p)}>{p.name}</button>)}</div>
        </div>
      )}
      <button className="demo-note" onClick={onDemo}>
        <b>Демо-режим, {fmtDow(now, true)}{sc ? `: ${sc.hint.toLowerCase()}` : ''}.</b>
        <span>Загрузка, цены и брони у парковок Алматы — симуляция. Время и сценарии — по кнопке с часами.</span>
      </button>
    </div>
  );
}
