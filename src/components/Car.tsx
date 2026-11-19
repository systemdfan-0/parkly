// «Где моя машина»: запомнить точку и заметку («−2 этаж, ряд B»), найти машину после перезапуска, удалить запись.
import { useState } from 'react';
import { useCar } from '../car/store';
import { useMap } from '../mapState';
import { useStore } from '../store';
import { navLink } from '../nav';
import { fmtDist } from '../engine/geo';
import { distM } from '../catalog/data';
import { Icon } from './Icon';

const when = (ms: number) => {
  const d = new Date(ms);
  const today = new Date().toDateString() === d.toDateString();
  return `${today ? 'сегодня' : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} в ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
};
const HOW = { lot: 'по парковке из приложения', gps: 'по GPS', map: 'отмечено на карте' } as const;

/** Карточка машины (Избранное, главный экран): где стоит, заметка, маршрут, изменить, удалить. */
export function CarSection({ compact = false }: { compact?: boolean }) {
  const car = useCar((s) => s.car);
  const { remove, setNote, setPicking, save } = useCar.getState();
  const geo = useMap((s) => s.geo);
  const [edit, setEdit] = useState(false);
  const [note, setNoteText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const byGps = async () => {
    setBusy(true); setMsg(null);
    await useMap.getState().locate();
    const g = useMap.getState().geo;
    setBusy(false);
    if (g.status === 'ok' && g.lat != null) {
      save({ lat: g.lat, lon: g.lon!, how: 'gps', note: car?.note ?? note, acc: g.acc });
      if ((g.acc ?? 0) > 50) setMsg(`Точность GPS ${Math.round(g.acc!)} м — в паркинге сигнал слабый. Можно поправить точку на карте.`);
    } else {
      setMsg(g.status === 'denied' ? 'Нет доступа к геолокации. Отметьте место на карте вручную.' : 'GPS не ответил — в паркинге так бывает. Отметьте место на карте вручную.');
    }
  };
  const onMap = () => {
    useCar.setState({ pendingNote: note });
    setPicking(true);
    useStore.getState().setTab('map');
    (document.activeElement as HTMLElement | null)?.blur?.();
  };
  const show = () => {
    if (!car) return;
    useStore.getState().setTab('map');
    useMap.getState().flyTo(car.lat, car.lon, 17);
  };

  if (!car) {
    if (compact) return null;
    return (
      <section className="car">
        <h3><Icon name="car" size={18} /> Где моя машина</h3>
        <p className="muted small">Запомните место перед уходом — запись останется на телефоне, пока вы её не удалите.</p>
        <input className="car__note" value={note} onChange={(e) => setNoteText(e.target.value)} placeholder="Заметка: −2 этаж, ряд B" maxLength={80} aria-label="Заметка о месте" />
        <div className="row">
          <button className="btn btn--primary btn--sm" onClick={byGps} disabled={busy}><Icon name="locate" size={16} /> {busy ? 'Ищу…' : 'Я здесь (GPS)'}</button>
          <button className="btn btn--ghost btn--sm" onClick={onMap}><Icon name="pin" size={16} /> Отметить на карте</button>
        </div>
        {msg && <p className="car__msg">{msg}</p>}
        {geo.status === 'asking' && <p className="muted small">Жду ответа GPS…</p>}
      </section>
    );
  }

  const me = geo.status === 'ok' && geo.lat != null ? distM(geo.lat, geo.lon!, car.lat, car.lon) : null;
  const walk = navLink({ lat: car.lat, lon: car.lon, label: 'Моя машина' }, true);
  return (
    <section className={`car car--saved ${compact ? 'car--compact' : ''}`}>
      <h3><Icon name="car" size={18} /> Моя машина</h3>
      <p className="car__where">{car.note || <span className="muted">Без заметки</span>}</p>
      <p className="muted small">
        {car.lotName ? `${car.lotName} · ` : ''}{HOW[car.how]}{car.acc && car.how === 'gps' ? ` (±${Math.round(car.acc)} м)` : ''}, {when(car.savedAt)}
        {me != null ? ` · от вас ${fmtDist(me)}` : ''}
      </p>
      {edit && (
        <div className="row">
          <input className="car__note" defaultValue={car.note} autoFocus maxLength={80} aria-label="Заметка о месте"
            onKeyDown={(e) => { if (e.key === 'Enter') { setNote((e.target as HTMLInputElement).value); setEdit(false); } }}
            onBlur={(e) => { setNote(e.target.value); setEdit(false); }} />
        </div>
      )}
      <div className="row">
        <button className="btn btn--primary btn--sm" onClick={show}><Icon name="map" size={16} /> На карте</button>
        <a className="btn btn--dark btn--sm" href={walk.href} target="_blank" rel="noreferrer"><Icon name="walk" size={16} /> {walk.text}</a>
        {!compact && <button className="btn btn--ghost btn--sm" onClick={() => setEdit(true)}>Заметка</button>}
        {!compact && <button className="btn btn--ghost btn--sm" onClick={onMap}>Поправить на карте</button>}
        <button className="btn btn--ghost btn--sm" onClick={() => { if (confirm('Удалить место машины?')) remove(); }}>Удалить</button>
      </div>
      {msg && <p className="car__msg">{msg}</p>}
    </section>
  );
}

/** Кнопка в карточке парковки: «Машина здесь» — точка этой парковки + заметка. */
export function ParkedHere({ lat, lon, name, id }: { lat: number; lon: number; name: string; id: string }) {
  const car = useCar((s) => s.car);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const here = car?.lotId === id;
  if (here && !open) return <p className="car__msg car__msg--ok"><Icon name="check" size={16} /> Машина отмечена здесь{car!.note ? `: ${car!.note}` : ''}. Найти — «Избранное» → «Моя машина».</p>;
  if (!open) return <button className="btn btn--ghost btn--sm btn--full" onClick={() => setOpen(true)}><Icon name="car" size={16} /> Я оставил машину здесь</button>;
  return (
    <form className="car car--inline" onSubmit={(e) => { e.preventDefault(); useCar.getState().save({ lat, lon, how: 'lot', note, lotName: name, lotId: id }); setOpen(false); }}>
      <input className="car__note" value={note} onChange={(e) => setNote(e.target.value)} autoFocus placeholder="Заметка: −2 этаж, ряд B" maxLength={80} aria-label="Заметка о месте" />
      <div className="row">
        <button className="btn btn--primary btn--sm" type="submit">Запомнить</button>
        <button className="btn btn--ghost btn--sm" type="button" onClick={() => setOpen(false)}>Отмена</button>
      </div>
    </form>
  );
}
