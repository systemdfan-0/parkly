import { useState } from 'react';
import { useStore } from '../store';
import type { Option } from '../engine/recommend';
import type { Booking } from '../engine/model';
import { rangeText } from '../engine/recommend';
import { tenge } from '../engine/pricing';
import { fmtTime, fmtDur, fmtDate } from '../engine/time';
import { Modal } from './Modal';
import { Icon } from './Icon';

export function Confirm({ o, onClose }: { o: Option; onClose: () => void }) {
  const book = useStore((s) => s.book);
  const destination = useStore((s) => s.destination);
  const setTab = useStore((s) => s.setTab);
  const pushNotice = useStore((s) => s.pushNotice);
  const [done, setDone] = useState<Booking | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const confirm = () => {
    const r = book({ lotId: o.lot.id, destName: destination?.name ?? o.lot.short, arriveAt: o.eta, durationMin: o.durationMin });
    if (typeof r === 'string') { setErr(r); return; }
    setDone(r);
    pushNotice({ kind: 'success', title: 'Демо-бронь подтверждена', text: `${o.lot.short}, код ${r.code}` });
  };

  if (done) {
    return (
      <Modal onClose={onClose} label="Бронь подтверждена">
        <div className="success">
          <div className="success__bay" aria-hidden="true"><b>{done.code}</b></div>
          <h2>Место за вами</h2>
          <p>{o.lot.name}. Ждём к {fmtTime(done.arriveAt)}, стоянка до {fmtTime(done.endAt)}. Покажите код на въезде.</p>
          <p className="muted">Отменить бесплатно можно до {fmtTime(done.arriveAt)} в разделе «Брони».</p>
          <div className="row">
            <button className="btn btn--ghost btn--grow" onClick={() => { setTab('trips'); onClose(); }}>Мои брони</button>
            <button className="btn btn--primary btn--grow" onClick={onClose}>Готово</button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} label="Подтверждение брони">
      <h2 className="modal__title">Забронировать место? <em className="src src--demo">демо</em></h2>
      <p className="muted small">Это демо-бронь: парковка и оплата симулируются, деньги не списываются.</p>
      <dl className="summary">
        <div><dt>Парковка</dt><dd>{o.lot.name}</dd></div>
        <div><dt>Приезд</dt><dd>{fmtDate(o.eta)}, {fmtTime(o.eta)} <small>({o.driveMin} мин в пути)</small></dd></div>
        <div><dt>Стоянка</dt><dd>{fmtDur(o.durationMin)}, до {fmtTime(o.eta + o.durationMin * 60000)}</dd></div>
        <div><dt>До входа</dt><dd>{o.walkMin} мин пешком</dd></div>
        <div><dt>Свободно</dt><dd>сейчас {o.freeNow}, к приезду {rangeText(o.fc)}</dd></div>
        <div className="summary__total"><dt>Итого</dt><dd>{o.price.total ? tenge(o.price.total) : 'Бесплатно'}</dd></div>
      </dl>
      <p className="muted small"><Icon name="info" size={14} /> Место закрепляется сразу и ждёт вас до приезда. Демо: деньги не списываются.</p>
      {err && <div className="banner banner--off"><Icon name="info" size={18} /><span>{err}</span></div>}
      <div className="row">
        <button className="btn btn--ghost" onClick={onClose}>Назад</button>
        <button className="btn btn--primary btn--grow" onClick={confirm} disabled={!!err}>Подтвердить демо-бронь</button>
      </div>
    </Modal>
  );
}
