import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import type { Option } from '../engine/recommend';
import { TAG_LABEL, arrivalForecast } from '../engine/recommend';
import { forecast } from '../engine/model';
import { tariffLabel, tenge } from '../engine/pricing';
import { KIND_LABEL, TYPE_LABEL } from '../data/places';
import { fmtTime, fmtDur, MIN } from '../engine/time';
import { fmtDist } from '../engine/geo';
import { ForecastLine } from './LotCard';
import { ForecastChart } from './ForecastChart';
import { DurationPicker } from './Results';
import { Icon } from './Icon';
import { navLink } from '../nav';
import { catalogNear } from '../catalog/data';
import { ParkedHere } from './Car';
import { MeasurementLine } from './Measurement';
import { RoutePanel } from './RoutePanel';
import { ReportBox } from './Report';

interface Props { o: Option; onBack: () => void; onBook: () => void; onMethod: () => void }

export function LotDetail({ o, onBack, onBook, onMethod }: Props) {
  const now = useStore((s) => s.sim.now);
  const occ = useStore((s) => s.sim.occ[o.lot.id] ?? 0);
  const bookings = useStore((s) => s.bookings);
  const favorites = useStore((s) => s.favorites);
  const watches = useStore((s) => s.watches);
  const toggleFavorite = useStore((s) => s.toggleFavorite);
  const toggleWatch = useStore((s) => s.toggleWatch);
  const pushNotice = useStore((s) => s.pushNotice);
  const destination = useStore((s) => s.destination);
  const setTab = useStore((s) => s.setTab);
  const lot = o.lot;
  const fav = favorites.includes(lot.id);
  const watching = watches.includes(lot.id);
  const myActive = bookings.find((b) => b.lotId === lot.id && b.status === 'active');
  const hist = useStore((s) => s.sim.hist[o.lot.id]);
  const hour = useMemo(() => forecast(lot, occ, now, o.driveMin, bookings, { seriesMin: 60, seriesStep: 5, runs: 200 }), [lot, occ, now, o.driveMin, bookings]);
  // точки офлайн-модели на 5/10/15 минут — поверх эвристического графика на час
  const mlPoints = useMemo(() => [5, 10, 15].map((h) => ({ h, r: arrivalForecast(lot, occ, now, h, bookings, hist) }))
    .filter((x) => x.r.source === 'ml').map((x) => ({ t: now + x.h * MIN, ...x.r.fc })), [lot, occ, now, bookings, hist]);
  const atDoor = o.eta + o.walkMin * MIN;
  const canBook = o.available && lot.bookable && o.freeNow > 0 && !myActive;
  // въезд — из каталога OSM: демо-парковка стоит на том же объекте (lot.osm)
  const [entr, setEntr] = useState<[number, number] | null>(null);
  useEffect(() => {
    setEntr(null);
    if (!lot.osm) return;
    let live = true;
    catalogNear(lot.lat, lot.lon, 80).then((ls) => { if (live) setEntr(ls.find((c) => c.osm === lot.osm)?.entr ?? null); }, () => {});
    return () => { live = false; };
  }, [lot]);
  const nav = navLink({ lat: lot.lat, lon: lot.lon, entr, label: lot.name });

  const watch = async () => {
    if (!watching && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch { /* только внутри приложения */ }
    }
    toggleWatch(lot.id);
    pushNotice(watching
      ? { kind: 'info', title: 'Уведомления выключены', text: lot.short }
      : { kind: 'info', title: 'Сообщим, когда появится место', text: o.freeNow ? `Сейчас мест: ${o.freeNow}. Напомним, если парковка заполнится и снова освободится.` : `${lot.short}: сейчас мест нет.` });
  };

  return (
    <div className="detail">
      <div className="detail__top">
        <button className="icon-btn icon-btn--dark" onClick={onBack} aria-label="Назад к списку"><Icon name="back" /></button>
        <div className="detail__title">
          <div className="card__tags">
            <span className="tag tag--demo">Демо</span>
            {o.tags.map((t) => <span key={t} className={`tag tag--${t}`}>{TAG_LABEL[t]}</span>)}
            {!o.available && <span className="tag tag--off">Недоступна</span>}
          </div>
          <h2>{lot.name}</h2>
          <p className="muted">{KIND_LABEL[lot.kind]} парковка, {TYPE_LABEL[lot.type].toLowerCase()}, всего {lot.capacity} мест</p>
        </div>
        <button className={`icon-btn icon-btn--dark ${fav ? 'is-on' : ''}`} onClick={() => toggleFavorite(lot.id)} aria-pressed={fav} aria-label={fav ? 'Убрать из избранного' : 'В избранное'}>
          <Icon name={fav ? 'star' : 'starO'} />
        </button>
      </div>

      {!o.available && <div className="banner banner--off"><Icon name="info" size={18} /><span>{o.unavailable}</span></div>}
      {o.available && o.warning && <div className="banner banner--warn"><Icon name="clock" size={18} /><span>{o.warning}</span></div>}

      {o.available && (
        <>
          <ol className="journey" aria-label="Маршрут по времени">
            <li><small>Выезд</small><b>{fmtTime(now)}</b></li>
            <li className="journey__leg"><Icon name="car" size={16} /><span>{o.driveMin} мин</span></li>
            <li><small>Парковка</small><b>{fmtTime(o.eta)}</b></li>
            <li className="journey__leg"><Icon name="walk" size={16} /><span>{o.walkMin} мин</span><span>{fmtDist(o.walkM)}</span></li>
            <li><small>{destination ? 'У входа' : 'На месте'}</small><b>{fmtTime(atDoor)}</b></li>
          </ol>

          <section className="block">
            <ForecastLine freeNow={o.freeNow} fc={o.fc} eta={o.eta} source={o.fcSource} />
            <ForecastChart fc={hour} now={now} eta={o.eta} ml={mlPoints} />
            <p className="chart__legend">
              <span className="lg lg--ml" /> ML-модель на 5, 10 и 15 мин
              <span className="lg lg--heur" /> эвристика на час
            </p>
            {o.fcSource === 'heuristic' && (
              <p className="small muted">До приезда {o.driveMin} мин — дальше 15 минут модель не обучена, поэтому прогноз к приезду считает эвристика потоков.</p>
            )}
            <p className="block__why">
              {o.trendText ? `Почему так: ${o.trendText}.` : 'Загрузка к приезду почти не изменится.'}
              {o.reserved > 0 && ` Сейчас забронировано через Parkly: ${o.reserved}.`}{' '}
              <button className="link" onClick={onMethod}>Как считается прогноз</button>
            </p>
          </section>

          <section className="block">
            <div className="price">
              <div>
                <small>Стоимость за {fmtDur(o.durationMin)}</small>
                <b>{o.price.total ? tenge(o.price.total) : 'Бесплатно'}</b>
              </div>
              <DurationPicker />
            </div>
            <ul className="price__lines">
              {o.price.lines.map((l) => <li key={l}>{l}</li>)}
              <li className="muted">Тариф: {tariffLabel(lot.tariff)}</li>
            </ul>
          </section>
        </>
      )}

      {lot.features.length > 0 && (
        <ul className="features">{lot.features.map((f) => <li key={f}>{f}</li>)}</ul>
      )}

      <MeasurementLine lotId={lot.id} />
      <RoutePanel lotId={lot.id} lot={{ lat: lot.lat, lon: lot.lon, entr }} dest={destination} />
      <div className="row detail__nav">
        <a className="btn btn--dark btn--grow" href={nav.href} target="_blank" rel="noreferrer"><Icon name="route" size={18} /> {nav.text}</a>
      </div>
      <p className="note">{nav.toEntrance ? 'Навигатор ведёт к въезду, отмеченному в OpenStreetMap.' : 'Въезд в OSM не отмечен — навигатор ведёт к самой парковке.'}</p>
      <ReportBox lotId={lot.id} now={now} demo />
      <ParkedHere lat={lot.lat} lon={lot.lon} name={lot.name} id={lot.id} />

      <div className="actionbar">
        <button className={`icon-btn icon-btn--bar ${watching ? 'is-on' : ''}`} onClick={watch} aria-pressed={watching}
          aria-label={watching ? 'Не сообщать о местах' : 'Сообщить, когда появится место'} disabled={!!lot.closedReason}>
          <Icon name={watching ? 'bell' : 'bellO'} />
        </button>
        {myActive ? (
          <button className="btn btn--dark btn--grow" onClick={() => setTab('trips')}>
            <Icon name="check" size={18} /> Место за вами до {fmtTime(myActive.endAt)}
          </button>
        ) : canBook ? (
          <button className="btn btn--primary btn--grow" onClick={onBook}>
            Забронировать{o.price.total ? ` за ${tenge(o.price.total)}` : ''}
          </button>
        ) : o.available && lot.bookable && o.freeNow === 0 ? (
          <button className={`btn btn--grow ${watching ? 'btn--dark' : 'btn--primary'}`} onClick={watching ? undefined : watch}>
            {watching ? 'Мест нет — ждём, сообщим' : 'Мест нет — сообщить, когда освободится'}
          </button>
        ) : o.available && !lot.bookable ? (
          <a className="btn btn--dark btn--grow" href={`https://2gis.kz/almaty/directions/points/%7C${lot.lon}%2C${lot.lat}`} target="_blank" rel="noreferrer">
            <Icon name="route" size={18} /> Без брони — маршрут в 2ГИС
          </a>
        ) : (
          <button className="btn btn--grow" disabled>Бронь недоступна</button>
        )}
      </div>
    </div>
  );
}
