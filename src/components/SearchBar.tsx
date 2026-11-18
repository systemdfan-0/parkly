import { useEffect, useMemo, useRef, useState } from 'react';
import { searchOnline } from '../engine/search';
import type { Place } from '../data/places';
import { useStore } from '../store';
import { useMap } from '../mapState';
import { fmtTime } from '../engine/time';
import { indexSync, loadIndex, loadPois, poisSync, type CatalogIndex, type Poi } from '../catalog/data';
import { matchCities, matchPlaces, type GeoHit } from '../catalog/geo';
import { tokens } from '../catalog/text';
import { Icon } from './Icon';

export function SearchBar({ onOpenDemo }: { onOpenDemo: () => void }) {
  const destination = useStore((s) => s.destination);
  const setDestination = useStore((s) => s.setDestination);
  const now = useStore((s) => s.sim.now);
  const speed = useStore((s) => s.sim.speed);
  const online = useMap((s) => s.online);
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState(false);
  const [data, setData] = useState<{ ix: CatalogIndex | null; pois: Poi[] | null }>({ ix: indexSync(), pois: poisSync() });
  const [remote, setRemote] = useState<{ state: 'idle' | 'loading' | 'done' | 'error'; items: Place[]; msg?: string }>({ state: 'idle', items: [] });
  const input = useRef<HTMLInputElement>(null);

  // каталог грузим при первом фокусе (13 тыс. мест — около 1 МБ, с диска телефона)
  useEffect(() => {
    if (!focus || (data.ix && data.pois)) return;
    Promise.all([loadIndex(), loadPois()]).then(([ix, pois]) => setData({ ix, pois }), () => {});
  }, [focus, data.ix, data.pois]);

  const hits = useMemo((): GeoHit[] => {
    const qw = tokens(q);
    if (!qw.length || !data.ix) return [];
    const v = useMap.getState().view;
    const cities = matchCities(data.ix, qw, new Set(), true).filter((h) => h.city!.lots > 0 || h.city!.place !== 'village').slice(0, 3);
    const places = matchPlaces(data.ix, data.pois, qw, { typing: true, near: v ? { lat: v.lat, lon: v.lon } : null }).slice(0, 7);
    // город наверх, если запрос — это город целиком
    return [...cities.filter((c) => c.score >= 100), ...places, ...cities.filter((c) => c.score < 100)].slice(0, 8);
  }, [q, data]);

  useEffect(() => { setRemote({ state: 'idle', items: [] }); }, [q]);
  useEffect(() => { if (!focus) setQ(''); }, [destination, focus]);

  const choose = (p: Place) => { setDestination(p); setQ(''); setFocus(false); input.current?.blur(); };

  const runOnline = async () => {
    if (!online) { setRemote({ state: 'error', items: [], msg: 'Нет интернета. Поиск адресов работает только онлайн; ориентиры и города из каталога ищутся без сети.' }); return; }
    setRemote({ state: 'loading', items: [] });
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 8000);
      const items = await searchOnline(q, ctl.signal).finally(() => clearTimeout(t));
      setRemote({ state: 'done', items });
    } catch {
      setRemote({ state: 'error', items: [], msg: 'Сервис адресов не ответил. Попробуйте ориентир или город из списка либо удерживайте палец на карте.' });
    }
  };

  const open = focus && q.trim().length > 0;
  const nothing = open && !!data.ix && hits.length === 0;

  return (
    <div className={`search ${open ? 'search--open' : ''}`}>
      <div className="search__bar">
        <span className="logo" aria-hidden="true"><b>P</b></span>
        <label className="sr-only" htmlFor="q">Куда едем</label>
        <input
          id="q" ref={input} value={focus ? q : q || destination?.name || ''} placeholder="Город или место"
          autoComplete="off" enterKeyHint="search"
          onFocus={() => { setFocus(true); setQ(''); }}
          onBlur={() => setTimeout(() => setFocus(false), 150)}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { if (hits[0]) choose(hits[0].place); else if (q.trim().length > 2) runOnline(); }
            if (e.key === 'Escape') input.current?.blur();
          }}
        />
        {(destination && !focus) || q ? (
          <button className="icon-btn" aria-label="Очистить" onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()}
            onClick={() => { if (q) { setQ(''); input.current?.focus(); } else setDestination(null); }}>
            <Icon name="x" size={18} />
          </button>
        ) : null}
        <button className="clock" onClick={onOpenDemo} aria-label="Демо-режим: время и симуляция">
          <Icon name={speed ? 'flask' : 'pause'} size={14} />
          <span>{fmtTime(now)}</span>
          {speed > 1 && <em>×{speed}</em>}
        </button>
      </div>

      {open && (
        <div className="search__list" role="listbox" onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()}>
          {!data.ix && <div className="sugg-empty"><p className="muted">Открываю каталог…</p></div>}
          {hits.map((h) => (
            <button key={h.place.id} role="option" aria-selected="false" className="sugg" onClick={() => choose(h.place)}>
              <Icon name={h.kind === 'city' ? 'map' : h.kind === 'street' ? 'route' : 'pin'} size={18} />
              <span><b>{h.place.name}</b><small>{h.hint}</small></span>
            </button>
          ))}
          {remote.items.map((p) => (
            <button key={p.id} className="sugg" onClick={() => choose(p)}>
              <Icon name="pin" size={18} />
              <span><b>{p.name}</b><small>{p.address}</small></span>
            </button>
          ))}
          {nothing && remote.state !== 'done' && (
            <div className="sugg-empty">
              <p><b>Ничего не нашли по «{q.trim()}».</b> В каталоге — города Казахстана, ТРЦ, вокзалы, театры, вузы. Проверьте написание или поищите точный адрес.</p>
              <button className="btn btn--ghost btn--sm" onClick={runOnline} disabled={remote.state === 'loading' || q.trim().length < 3}>
                {remote.state === 'loading' ? 'Ищу в OpenStreetMap…' : 'Найти адрес в OpenStreetMap (онлайн)'}
              </button>
              {remote.state === 'error' && <p className="muted">{remote.msg}</p>}
            </div>
          )}
          {nothing && remote.state === 'done' && remote.items.length === 0 && (
            <div className="sugg-empty"><p><b>Адрес «{q.trim()}» не найден.</b> Проверьте написание или поставьте точку на карте долгим нажатием.</p></div>
          )}
          {!nothing && data.ix && q.trim().length > 2 && remote.state === 'idle' && (
            <button className="sugg sugg--more" onClick={runOnline}>
              <Icon name="search" size={18} /><span><b>Искать точный адрес</b><small>OpenStreetMap, нужен интернет</small></span>
            </button>
          )}
          {remote.state === 'error' && !nothing && <div className="sugg-empty"><p className="muted">{remote.msg}</p></div>}
        </div>
      )}
    </div>
  );
}
