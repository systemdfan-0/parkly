import { useEffect, useState } from 'react';
import { useStore } from '../store';
import type { Option } from '../engine/recommend';
import type { Booking } from '../engine/model';
import { rangeText } from '../engine/recommend';
import { tenge } from '../engine/pricing';
import { fmtTime, fmtDur, fmtDate } from '../engine/time';
import { Modal } from './Modal';
import { Icon } from './Icon';

/** Для кнопки «Назад»: завершена ли бронь (иначе «Назад» = отмена оплаты). */
export const confirmState = { done: false };

export function Confirm({ o, onClose }: { o: Option; onClose: () => void }) {
  const book = useStore((s) => s.book);
  const destination = useStore((s) => s.destination);
  const setTab = useStore((s) => s.setTab);
  const pushNotice = useStore((s) => s.pushNotice);
  const [done, setDone] = useState<Booking | null>(null);
  useEffect(() => { confirmState.done = false; }, []);
  const [err, setErr] = useState<string | null>(null);
  const total = o.price.total;
  const [pay, setPay] = useState<'kaspi' | 'onsite'>(total > 0 ? 'kaspi' : 'onsite');
  // шаг оплаты Kaspi (демо): подтверждение → «оплачиваю…» → бронь
  const [kaspi, setKaspi] = useState<'off' | 'ask' | 'paying'>('off');

  const confirm = () => {
    const r = book({ lotId: o.lot.id, destName: destination?.name ?? o.lot.short, arriveAt: o.eta, durationMin: o.durationMin, pay });
    if (typeof r === 'string') { setErr(r); setKaspi('off'); return; }
    setDone(r);
    confirmState.done = true;
    pushNotice({ kind: 'success', title: r.paid ? 'Оплачено через Kaspi (демо)' : 'Демо-бронь подтверждена', text: `${o.lot.short}, код ${r.code}${r.paid ? `, ${tenge(r.paid.amount)}` : ''}` });
  };
  const start = () => { if (pay === 'kaspi' && total > 0) setKaspi('ask'); else confirm(); };
  const payKaspi = () => { setKaspi('paying'); setTimeout(confirm, 1400); };

  if (kaspi !== 'off' && !done) {
    return (
      <Modal onClose={() => kaspi === 'ask' && setKaspi('off')} label="Оплата через Kaspi (демо)">
        <div className="kaspi">
          <p className="kaspi__tag">Kaspi · демо-оплата</p>
          <h2>{tenge(total)}</h2>
          <p className="muted">Parkly · {o.lot.name}, {fmtDur(o.durationMin)}</p>
          <ul className="kaspi__steps small">
            <li>В рабочей версии здесь откроется приложение Kaspi.kz с готовым счётом.</li>
            <li>Подтверждаете оплату в Kaspi — бронь закрепляется, чек приходит в «Брони».</li>
          </ul>
          <p className="muted small"><Icon name="info" size={14} /> Демо: деньги не списываются, данные карты и телефона не запрашиваются.</p>
          {kaspi === 'ask' ? (
            <div className="row">
              <button className="btn btn--ghost" onClick={() => setKaspi('off')}>Назад</button>
              <button className="btn btn--kaspi btn--grow" onClick={payKaspi}>Оплатить {tenge(total)}</button>
            </div>
          ) : (
            <div className="kaspi__wait" role="status"><span className="spin" /> Оплачиваю…</div>
          )}
        </div>
      </Modal>
    );
  }

  if (done) {
    return (
      <Modal onClose={onClose} label="Бронь подтверждена">
        <div className="success">
          <div className="success__bay" aria-hidden="true"><b>{done.code}</b></div>
          <h2>Место за вами</h2>
          <p>{o.lot.name}. Ждём к {fmtTime(done.arriveAt)}, стоянка до {fmtTime(done.endAt)}. Покажите код на въезде.</p>
          {done.paid
            ? <p className="paidline"><Icon name="check" size={16} /> Оплачено через Kaspi (демо) · {tenge(done.paid.amount)} · чек {done.paid.receipt}</p>
            : done.price > 0 && <p className="muted small">Оплата на месте при въезде.</p>}
          <p className="muted">Отменить бесплатно можно до {fmtTime(done.arriveAt)} в разделе «Брони»{done.paid ? ' — демо-оплата вернётся' : ''}.</p>
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
      {total > 0 && (
        <div className="paychoice" role="radiogroup" aria-label="Способ оплаты">
          <button role="radio" aria-checked={pay === 'kaspi'} className={pay === 'kaspi' ? 'on' : ''} onClick={() => setPay('kaspi')}>
            <span className="paychoice__k">K</span><span><b>Kaspi</b><small>сразу, в одно касание · демо</small></span>
          </button>
          <button role="radio" aria-checked={pay === 'onsite'} className={pay === 'onsite' ? 'on' : ''} onClick={() => setPay('onsite')}>
            <span className="paychoice__k paychoice__k--cash">₸</span><span><b>На месте</b><small>при въезде на парковку</small></span>
          </button>
        </div>
      )}
      <p className="muted small"><Icon name="info" size={14} /> Место закрепляется сразу и ждёт вас до приезда. Демо: деньги не списываются.</p>
      {err && <div className="banner banner--off"><Icon name="info" size={18} /><span>{err}</span></div>}
      <div className="row">
        <button className="btn btn--ghost" onClick={onClose}>Назад</button>
        <button className={`btn btn--grow ${pay === 'kaspi' && total > 0 ? 'btn--kaspi' : 'btn--primary'}`} onClick={start} disabled={!!err}>
          {pay === 'kaspi' && total > 0 ? `Оплатить через Kaspi · ${tenge(total)}` : 'Подтвердить демо-бронь'}
        </button>
      </div>
    </Modal>
  );
}
