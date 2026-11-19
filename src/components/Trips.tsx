import { useStore } from '../store';
import { LOT_BY_ID } from '../data/places';
import { tenge } from '../engine/pricing';
import { fmtTime, fmtDate, fmtDur, parts } from '../engine/time';
import type { Booking } from '../engine/model';
import { plural } from '../format';
import { Icon } from './Icon';

const MONTHS = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];

export function Trips() {
  const bookings = useStore((s) => s.bookings);
  const now = useStore((s) => s.sim.now);
  const cancel = useStore((s) => s.cancelBooking);
  const finish = useStore((s) => s.finishBooking);
  const pushNotice = useStore((s) => s.pushNotice);
  const active = bookings.filter((b) => b.status === 'active').sort((a, b) => a.arriveAt - b.arriveAt);
  const past = bookings.filter((b) => b.status !== 'active').sort((a, b) => (b.closedAt ?? b.endAt) - (a.closedAt ?? a.endAt));
  const p = parts(now);
  const month = bookings.filter((b) => b.status !== 'cancelled' && parts(b.arriveAt).mo === p.mo && parts(b.arriveAt).y === p.y);
  const spent = month.reduce((s, b) => s + b.price, 0);

  return (
    <div className="trips">
      <h2>Брони и расходы</h2>
      <div className="spend">
        <div><small>Потрачено в {MONTHS[p.mo]}</small><b>{tenge(spent) === 'бесплатно' ? '0 ₸' : tenge(spent)}</b></div>
        <div><small>Поездок</small><b>{month.length}</b></div>
        <div><small>Средний чек</small><b>{month.length ? `${Math.round(spent / month.length)} ₸` : '—'}</b></div>
      </div>

      <h3>Активные</h3>
      {active.length === 0 && <p className="muted">Активных броней нет. Найдите место через поиск — бронь появится здесь.</p>}
      {active.map((b) => {
        const lot = LOT_BY_ID[b.lotId];
        const before = now < b.arriveAt;
        return (
          <article key={b.id} className="trip trip--active">
            <div className="trip__code" aria-label={`Код брони ${b.code}`}>{b.code}</div>
            <div className="trip__body">
              <b>{lot.name}</b>
              <span className="muted">{b.destName}</span>
              <span>{before ? `Ждём к ${fmtTime(b.arriveAt)} — место за вами` : `Стоянка идёт до ${fmtTime(b.endAt)}`}</span>
              <span className="trip__meta">{fmtDur(b.durationMin)}, {b.price ? tenge(b.price) : 'бесплатно'}{b.paid ? <> · <em className="paid">оплачено Kaspi (демо), чек {b.paid.receipt}</em></> : b.price ? ' · оплата на месте' : ''}</span>
            </div>
            {before ? (
              <button className="btn btn--ghost btn--sm" onClick={() => { cancel(b.id); pushNotice({ kind: 'info', title: 'Бронь отменена', text: `${lot.short}: место снова свободно${b.paid ? ', демо-оплата Kaspi возвращена' : ', деньги не списаны'}` }); }}>
                Отменить бесплатно
              </button>
            ) : (
              <button className="btn btn--ghost btn--sm" onClick={() => { finish(b.id); pushNotice({ kind: 'info', title: 'Парковка завершена', text: lot.short }); }}>
                Завершить
              </button>
            )}
          </article>
        );
      })}

      <h3>История</h3>
      {past.length === 0 && <p className="muted">Здесь появятся завершённые поездки.</p>}
      <ul className="history">
        {past.map((b: Booking) => (
          <li key={b.id} className={b.status === 'cancelled' ? 'is-cancel' : ''}>
            <Icon name={b.status === 'cancelled' ? 'x' : 'check'} size={16} />
            <span>
              <b>{LOT_BY_ID[b.lotId].short}</b>
              <small>{fmtDate(b.arriveAt)}, {fmtTime(b.arriveAt)}–{fmtTime(b.endAt)}, {b.destName}{b.seeded ? ' (демо)' : ''}</small>
            </span>
            <em>{b.status === 'cancelled' ? 'Отменена' : b.price ? tenge(b.price) : '0 ₸'}</em>
          </li>
        ))}
      </ul>
      <p className="note">Оплата в демо не списывается. {past.length} {plural(past.length, ['запись', 'записи', 'записей'])} в истории.</p>
    </div>
  );
}
