// Экран оплаты Kaspi (демо) — общий для брони и тестового платежа. Таймер «Оплачиваю…» живёт в usePayAttempt
// и гасится, если окно закрыли (системная «Назад», крестик, смена экрана) — оплата тогда считается отменённой.
import { useEffect, useRef, useState } from 'react';
import { DEMO_PAY, receiptNo, startPayment, type PayAttempt } from '../engine/payment';
import { tenge } from '../engine/pricing';
import { fmtTime, fmtDur } from '../engine/time';
import { useStore } from '../store';
import { Modal } from './Modal';
import { Icon } from './Icon';

export function usePayAttempt() {
  const att = useRef<PayAttempt | null>(null);
  const [paying, setPaying] = useState(false);
  useEffect(() => () => { att.current?.cancel(); }, []);
  const pay = (onPaid: () => void) => {
    att.current?.cancel();
    setPaying(true);
    att.current = startPayment(() => { setPaying(false); onPaid(); });
  };
  const cancel = () => { const ok = !!att.current?.cancel(); setPaying(false); return ok; };
  return { paying, pay, cancel };
}

export function KaspiSheet({ amount, sub, steps, paying, onPay, onBack, onCancel }: {
  amount: number; sub: string; steps: string[]; paying: boolean; onPay: () => void; onBack: () => void; onCancel: () => void;
}) {
  return (
    <Modal onClose={paying ? onCancel : onBack} label="Оплата через Kaspi (демо)">
      <div className="kaspi">
        <p className="kaspi__tag">Kaspi · демо-оплата</p>
        <h2>{tenge(amount)}</h2>
        <p className="muted">{sub}</p>
        <ul className="kaspi__steps small">{steps.map((s) => <li key={s}>{s}</li>)}</ul>
        <p className="muted small"><Icon name="info" size={14} /> Демо: деньги не списываются, данные карты и телефона не запрашиваются.</p>
        {paying ? (
          <>
            <div className="kaspi__wait" role="status"><span className="spin" /> Оплачиваю…</div>
            <button className="btn btn--ghost btn--full" onClick={onCancel}>Отменить оплату</button>
          </>
        ) : (
          <div className="row">
            <button className="btn btn--ghost" onClick={onBack}>Назад</button>
            <button className="btn btn--kaspi btn--grow" onClick={onPay}>Оплатить {tenge(amount)}</button>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Для системной «Назад»: чем закончился тестовый платёж. */
export const demoPayState = { done: false, paying: false };

/** Тестовый платёж с обычной точки OSM: 600 ₸ за 2 часа, демо-чек, место НЕ бронируется. */
export function DemoPay({ name, fee, onClose }: { name: string; fee: string; onClose: () => void }) {
  const now = useStore((s) => s.sim.now);
  const pushNotice = useStore((s) => s.pushNotice);
  const p = usePayAttempt();
  const [receipt, setReceipt] = useState<{ no: string; at: number } | null>(null);
  useEffect(() => { demoPayState.done = false; }, []);
  demoPayState.paying = p.paying;

  if (receipt) {
    return (
      <Modal onClose={onClose} label="Демо-чек">
        <div className="success">
          <h2>Демо-чек</h2>
          <p className="paidline"><Icon name="check" size={16} /> Оплачено через Kaspi (демо) · {tenge(DEMO_PAY.amount)} · чек {receipt.no}</p>
          <dl className="summary">
            <div><dt>Парковка</dt><dd>{name}</dd></div>
            <div><dt>Время</dt><dd>{fmtDur(DEMO_PAY.durationMin)}, оплачено в {fmtTime(receipt.at)}</dd></div>
            <div><dt>Цена по OSM</dt><dd>{fee}</dd></div>
          </dl>
          <p className="muted small">Это тестовый платёж: место не бронировалось, деньги не списаны. Бронь есть только у демо-парковок ТРЦ и БЦ.</p>
          <div className="row"><button className="btn btn--primary btn--grow" onClick={onClose}>Готово</button></div>
        </div>
      </Modal>
    );
  }
  const cancel = () => { if (p.cancel()) pushNotice({ kind: 'info', title: 'Оплата отменена', text: 'Деньги не списаны, чека нет.' }); };
  return (
    <KaspiSheet amount={DEMO_PAY.amount} sub={`Тестовый платёж · ${name}, ${fmtDur(DEMO_PAY.durationMin)}`} paying={p.paying}
      steps={['Проверка оплаты, а не бронь: место на этой парковке не закрепляется.', `Цена парковки по OSM остаётся прежней: ${fee.charAt(0).toLowerCase() + fee.slice(1)}.`]}
      onBack={onClose} onCancel={cancel}
      onPay={() => p.pay(() => {
        demoPayState.done = true;
        const r = { no: receiptNo(), at: now };
        setReceipt(r);
        pushNotice({ kind: 'success', title: 'Демо-чек готов', text: `${name}: ${tenge(DEMO_PAY.amount)}, чек ${r.no}. Место не бронировалось.` });
      })} />
  );
}
