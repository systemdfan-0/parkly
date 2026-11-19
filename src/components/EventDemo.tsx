// Экран демо «После мероприятия» (СИМУЛЯЦИЯ): один и тот же поток машин в двух режимах на одном экране.
import { useMemo, useState } from 'react';
import { compareEvent, eventLevels, DEFAULT_EVENT, EVENT_LOTS, type ModeResult } from '../engine/event';
import { fmtTime } from '../engine/time';
import { EVENT_START } from '../engine/event';
import { Modal } from './Modal';
import { PinAvatar } from './Pin';

const pc = (x: number) => `${Math.round(x * 100)}%`;
const f1 = (x: number) => x.toFixed(1).replace('.', ',');

function Metrics({ a, b }: { a: ModeResult; b: ModeResult }) {
  const rows: [string, string, string, boolean | null][] = [
    ['Приехали на полную', pc(a.fullShare), pc(b.fullShare), b.fullShare < a.fullShare ? true : b.fullShare > a.fullShare ? false : null],
    ['Пешком в среднем', `${f1(a.avgWalk)} мин`, `${f1(b.avgWalk)} мин`, b.avgWalk < a.avgWalk - 0.05 ? true : b.avgWalk > a.avgWalk + 0.05 ? false : null],
    ['Так и не встали рядом', String(a.leftArea), String(b.leftArea), b.leftArea < a.leftArea ? true : b.leftArea > a.leftArea ? false : null],
    ['Нет подходящих по цене и ходьбе', String(a.noOption), String(b.noOption), null],
    ['Выбрали и отменили', String(a.cancelled), String(b.cancelled), null],
  ];
  return (
    <table className="evt__table">
      <thead><tr><th /><th>Каждому отдельно</th><th>С учётом выбравших</th></tr></thead>
      <tbody>
        {rows.map(([k, x, y, good]) => (
          <tr key={k}><th>{k}</th><td>{x}</td><td className={good === true ? 'good' : good === false ? 'bad' : ''}>{y}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

function Lots({ a, b }: { a: ModeResult; b: ModeResult }) {
  return (
    <div className="evt__lots">
      {a.lots.map((la) => {
        const lb = b.lots.find((x) => x.id === la.id)!;
        return (
          <div key={la.id} className="evt__lot">
            <div className="evt__lotname"><b>{la.short}</b><span className="muted small">{la.walk} мин пешком · {la.capacity} мест</span></div>
            {[['Отдельно', la], ['С учётом', lb]].map(([label, l]) => {
              const s = l as typeof la;
              return (
                <div key={label as string} className="evt__bar">
                  <span className="muted small">{label as string}</span>
                  <div className="evt__track" aria-label={`пик загрузки ${pc(s.peakPct)}`}><i style={{ width: pc(Math.min(1, s.peakPct)) }} className={s.peakPct >= 0.999 ? 'full' : ''} /></div>
                  <span className="small">{s.assigned} маш.{s.fullArrivals ? <em> · {s.fullArrivals} на полную</em> : ''}</span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export function EventDemo({ onClose }: { onClose: () => void }) {
  const [cars, setCars] = useState(DEFAULT_EVENT.cars);
  const [seed, setSeed] = useState(DEFAULT_EVENT.seed);
  const s = { ...DEFAULT_EVENT, cars, seed };
  const c = useMemo(() => compareEvent(s), [cars, seed]); // eslint-disable-line react-hooks/exhaustive-deps
  const levels = useMemo(() => eventLevels({ ...DEFAULT_EVENT, seed }), [seed]);
  return (
    <Modal onClose={onClose} label="После мероприятия — симуляция" wide>
      <div className="evt">
        <div className="evt__head">
          <span className="tag tag--off">Симуляция</span>
          <h2>После мероприятия</h2>
          <p className="muted small">
            Район театра Абая, будни, {fmtTime(EVENT_START)}. За {DEFAULT_EVENT.windowMin} минут {cars} водителей спрашивают Parkly, где встать
            (в пути 4–15 мин, у каждого лимит цены и ходьбы, {Math.round(DEFAULT_EVENT.cancelShare * 100)}% потом отменяют поездку).
            Фоновые машины без Parkly — модель демо. Поток один и тот же для обоих режимов.
          </p>
        </div>

        <label className="evt__slider">
          <span>Машин: <b>{cars}</b></span>
          <input type="range" min={10} max={200} step={10} value={cars} onChange={(e) => setCars(+e.target.value)} aria-label="Число машин" />
        </label>
        <div className="row small">
          <span className="muted">Поток №{seed} — тот же номер даёт тот же результат.</span>
          <button className="btn btn--ghost btn--sm" onClick={() => setSeed((x) => x + 1)}>Другой поток</button>
        </div>

        <div className="evt__modes small muted">
          <p><b>Каждому отдельно</b> — как сейчас: ML-прогноз к приезду, рекомендации не знают друг о друге.</p>
          <p><b>С учётом выбравших</b> — тот же прогноз, но из свободных мест вычитаются машины, которые уже выбрали эту парковку и приедут раньше; отмена поездки возвращает место.</p>
        </div>

        <Metrics a={c.a} b={c.b} />

        {c.pin && (
          <div className="bubble bubble--pin evt__pin">
            <div className="row"><PinAvatar size={28} /><b>Пин</b><em className="src src--demo">симуляция</em></div>
            <p>{c.pin}</p>
          </div>
        )}

        <h3>Загрузка парковок (пик за 50 минут)</h3>
        <Lots a={c.a} b={c.b} />

        <h3>Разная нагрузка, тот же поток №{seed}</h3>
        <table className="evt__table evt__levels">
          <thead><tr><th>Машин</th><th>На полную</th><th>Пешком, мин</th><th>Не встали</th></tr></thead>
          <tbody>
            {levels.map((x) => (
              <tr key={x.cars} className={x.cars === cars ? 'on' : ''}>
                <th>{x.cars}</th>
                <td>{pc(x.a.fullShare)} → <b className={x.b.fullShare < x.a.fullShare ? 'good' : x.b.fullShare > x.a.fullShare ? 'bad' : ''}>{pc(x.b.fullShare)}</b></td>
                <td>{f1(x.a.avgWalk)} → <b className={x.b.avgWalk > x.a.avgWalk + 0.05 ? 'bad' : ''}>{f1(x.b.avgWalk)}</b></td>
                <td>{x.a.leftArea} → {x.b.leftArea}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="note">
          Это симуляция на демо-парковках ({EVENT_LOTS.length} в радиусе 1,1 км), а не замеры. Учёт выбравших помогает, когда много машин
          целятся в одни и те же ближние парковки; при перегрузке района мест не хватает обоим режимам, а платой за меньшее число
          приездов на полную бывает чуть больше ходьбы. Пересчитать: тесты <code>tests/event.test.ts</code>.
        </p>
      </div>
    </Modal>
  );
}
