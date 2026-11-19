// Блоки экрана «Как работает ИИ»: живая проверка модели намерений Пина.
import { useState, type ReactNode } from 'react';
import { classify } from '../engine/intent';
import { INTENT_MODEL } from '../engine/pinTalk';

const RU: Record<string, string> = {
  help: 'что умеешь', who: 'кто ты', pay: 'оплата', cancel: 'отмена брони', disabled: 'места ♿', ev: 'зарядка', rules: 'штрафы, правила',
  ml: 'как работает ИИ', source: 'откуда данные', offline: 'без интернета', geo: 'приватность', colors: 'цвета меток', update: 'обновление',
  time: 'время', offtopic: 'не про парковки', joke: 'шутка', rude: 'грубость', thanks: 'спасибо', hi: 'привет', bye: 'пока', how: 'как дела',
  ok: 'ок', near: 'рядом со мной', price: 'цена', cap: 'места', hours: 'часы работы', book: 'бронь', query: 'место / подбор',
};

function IntentLive() {
  const [t, setT] = useState('чё по каспи');
  const top = t.trim() ? classify(INTENT_MODEL, t).slice(0, 3) : [];
  const pc = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')}%`;
  return (
    <div className="ai__live">
      <p className="small"><b>Модель намерений</b> (логистическая регрессия, {INTENT_MODEL.labels.length} намерений, {INTENT_MODEL.nTrain} обучающих фраз): точность на отложенных фразах с опечатками — <b className="ok">{pc(INTENT_MODEL.acc)}</b>. Проверьте сами:</p>
      <input className="car__note" value={t} onChange={(e) => setT(e.target.value)} placeholder="Напишите что угодно" aria-label="Фраза для модели" />
      {top.map((x, i) => (
        <div key={x.label} className="ai__bar">
          <span className="small">{RU[x.label] ?? x.label}</span>
          <div className="ai__track"><i className={i === 0 ? 'ours' : ''} style={{ width: `${x.p * 100}%` }} /></div>
          <b className={i === 0 ? 'ours' : ''}>{Math.round(x.p * 100)}%</b>
        </div>
      ))}
      <p className="muted small">Правила Пина срабатывают первыми; модель помогает, когда фраза необычная, и только при уверенности ≥ 60%.</p>
    </div>
  );
}

export const AI_EXTRA: { intent: ReactNode; vision: ReactNode } = { intent: <IntentLive />, vision: null };
