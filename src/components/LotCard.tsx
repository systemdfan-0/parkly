import { forwardRef } from 'react';
import type { Option } from '../engine/recommend';
import { TAG_LABEL, rangeText } from '../engine/recommend';
import { tenge } from '../engine/pricing';
import { fmtTime, fmtDur } from '../engine/time';
import { levelOf, pctText, spots, spotsWord } from '../format';
import { Icon } from './Icon';
import type { Forecast } from '../engine/model';
import { useStore } from '../store';
const useArriveIn = () => useStore((s) => s.arriveIn);

/** «Сейчас 2 места · к 18:40 ожидается 4–6» — главная строка прогноза. */
export function SourceTag({ source }: { source: 'ml' | 'heuristic' }) {
  return source === 'ml'
    ? <em className="src src--ml" title="Офлайн-модель (дерево решений), горизонт до 15 минут">ML-модель</em>
    : <em className="src src--heur" title="До приезда больше 15 минут или нет замеров — модель потоков">эвристика</em>;
}

export function ForecastLine({ freeNow, fc, eta, available = true, source }: { freeNow: number; fc: Forecast; eta: number; available?: boolean; source?: 'ml' | 'heuristic' }) {
  const lvl = levelOf(fc.pFree, available);
  const trend = fc.mid - freeNow >= 2 ? 'up' : fc.mid - freeNow <= -2 ? 'down' : 'flat';
  return (
    <div className={`fline fline--${lvl}`}>
      <span className="fline__now"><small>Сейчас</small><b>{freeNow ? spots(freeNow) : 'мест нет'}</b></span>
      <span className={`fline__road fline__road--${trend}`} aria-hidden="true" />
      <span className="fline__eta">
        <small>к {fmtTime(eta)} ожидается</small>
        <b>{rangeText(fc)} <span>{spotsWord(fc.hi)}</span></b>
      </span>
      <span className="fline__p" title="Шанс найти место к приезду">
        <b>{pctText(fc.pFree)}</b><small>шанс</small>
        {source && <SourceTag source={source} />}
      </span>
    </div>
  );
}

interface Props { o: Option; selected: boolean; onClick: () => void; onHover?: (on: boolean) => void }

export const LotCard = forwardRef<HTMLButtonElement, Props>(function LotCard({ o, selected, onClick }, ref) {
  const arriveIn = useArriveIn();
  const best = o.tags.includes('best');
  return (
    <button ref={ref} className={`card ${selected ? 'card--sel' : ''} ${best ? 'card--best' : ''} ${o.available ? '' : 'card--off'}`} onClick={onClick}
      aria-label={`${o.lot.name}. ${o.reason}`}>
      <div className="card__tags">
        <span className="tag tag--demo">Демо</span>
        {o.tags.map((t) => <span key={t} className={`tag tag--${t}`}>{TAG_LABEL[t]}</span>)}
        {!o.available && <span className="tag tag--off">Недоступна</span>}
        {o.available && !o.lot.bookable && <span className="tag tag--plain">Без брони</span>}
      </div>
      <div className="card__name">{o.lot.name}</div>
      {o.available ? (
        <>
          <div className="card__metrics">
            <span><Icon name="walk" size={16} /><b>{o.walkMin}</b><small>мин пешком</small></span>
            <span><Icon name="wallet" size={16} /><b>{o.price.total ? o.price.total.toLocaleString('ru-RU') : '0'}</b><small>{o.price.total ? `₸ за ${fmtDur(o.durationMin)}` : 'бесплатно'}</small></span>
            <span><Icon name="car" size={16} /><b>{o.driveMin}</b><small>{arriveIn ? 'мин до приезда' : 'мин в пути'}</small></span>
          </div>
          <ForecastLine freeNow={o.freeNow} fc={o.fc} eta={o.eta} source={o.fcSource} />
          <p className="card__why">{o.reason}</p>
          {o.compare.length > 0 && (
            <div className="card__cmp">
              {o.compare.map((c) => <span key={c.label} className={c.good ? 'good' : 'bad'}>{c.label}</span>)}
            </div>
          )}
        </>
      ) : (
        <p className="card__why card__why--off">{o.reason}</p>
      )}
    </button>
  );
});

export { tenge };
