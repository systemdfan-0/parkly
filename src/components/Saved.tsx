import { useStore } from '../store';
import { DESTINATIONS, LOT_BY_ID, destToPlace } from '../data/places';
import { freeNow, isOpenAt } from '../engine/model';
import { haversine } from '../engine/geo';
import { spots } from '../format';
import { Icon } from './Icon';
import { AppSection } from './UpdateScreen';
import { CarSection } from './Car';
import { TrafficKeySection } from './RoutePanel';

/** Открыть парковку: назначение — ближайший ориентир, парковка выбрана. */
export function useOpenLot() {
  const setDestination = useStore((s) => s.setDestination);
  const selectLot = useStore((s) => s.selectLot);
  const destination = useStore((s) => s.destination);
  return (id: string) => {
    const lot = LOT_BY_ID[id];
    const near = destination && haversine(destination.lat, destination.lon, lot.lat, lot.lon) < 900
      ? null
      : [...DESTINATIONS].sort((a, b) => haversine(lot.lat, lot.lon, a.lat, a.lon) - haversine(lot.lat, lot.lon, b.lat, b.lon))[0];
    if (near) setDestination(destToPlace(near));
    useStore.getState().setTab('map');
    selectLot(id);
  };
}

export function Saved() {
  const favorites = useStore((s) => s.favorites);
  const watches = useStore((s) => s.watches);
  const recent = useStore((s) => s.recent);
  const now = useStore((s) => s.sim.now);
  const occ = useStore((s) => s.sim.occ);
  const bookings = useStore((s) => s.bookings);
  const toggleFavorite = useStore((s) => s.toggleFavorite);
  const toggleWatch = useStore((s) => s.toggleWatch);
  const setDestination = useStore((s) => s.setDestination);
  const open = useOpenLot();

  const row = (id: string, kind: 'fav' | 'watch') => {
    const lot = LOT_BY_ID[id];
    const openNow = isOpenAt(lot, now);
    const f = freeNow(lot, occ[id] ?? 0, now, bookings);
    return (
      <li key={kind + id} className="saved">
        <button className="saved__main" onClick={() => open(id)}>
          <span className={`dot dot--${!openNow ? 'off' : f === 0 ? 'full' : f < 4 ? 'tight' : 'ok'}`} aria-hidden="true" />
          <span><b>{lot.name}</b><small>{!openNow ? (lot.closedReason ?? 'Закрыта') : f ? `Сейчас ${spots(f)}` : 'Сейчас мест нет'}</small></span>
        </button>
        {kind === 'fav'
          ? <button className="icon-btn icon-btn--dark is-on" onClick={() => toggleFavorite(id)} aria-label="Убрать из избранного"><Icon name="star" /></button>
          : <button className="icon-btn icon-btn--dark is-on" onClick={() => toggleWatch(id)} aria-label="Не сообщать о местах"><Icon name="bell" /></button>}
      </li>
    );
  };

  return (
    <div className="savedv">
      <h2>Избранное</h2>
      <CarSection />
      {favorites.length ? <ul className="saved-list">{favorites.map((id) => row(id, 'fav'))}</ul>
        : <p className="muted">Отмечайте звёздочкой парковки, куда ездите часто, — здесь будет видно, сколько там мест прямо сейчас.</p>}
      <h3>Жду свободное место</h3>
      {watches.length ? <ul className="saved-list">{watches.map((id) => row(id, 'watch'))}</ul>
        : <p className="muted">Нажмите колокольчик на парковке без мест — Parkly сообщит, когда место освободится.</p>}
      {recent.length > 0 && (
        <>
          <h3>Недавние места</h3>
          <div className="chips">{recent.map((p) => <button key={p.id} className="chip" onClick={() => setDestination(p)}>{p.name}</button>)}</div>
        </>
      )}
      <AppSection />
      <TrafficKeySection />
    </div>
  );
}
