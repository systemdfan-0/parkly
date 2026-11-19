// «Как работает ИИ в Parkly» — все модели и их проверка на одном экране. Числа берутся из отчётов обучения, а не вписаны руками.
import { useMemo } from 'react';
import { ML_INFO } from '../ml/predict';
import arrivals from '../../ml/arrivals.json';
import { compareEvent, DEFAULT_EVENT } from '../engine/event';
import { Modal } from './Modal';
import { Icon } from './Icon';
import { AI_EXTRA } from './aiExtra';

const f1 = (x: number) => x.toFixed(1).replace('.', ',');
const pc = (a: number, n: number) => `${f1((a / n) * 100)}%`;
const FEAT_RU: Record<string, string> = {
  hour: 'время суток', free: 'свободно сейчас', free_frac: 'доля свободных', d5_frac: 'изменение за 5 мин', d10_frac: 'изменение за 10 мин',
  d15_frac: 'изменение за 15 мин', type_street: 'уличная парковка', type_theatre: 'театр', type_mall: 'ТРЦ', dow: 'день недели', weekend: 'выходной',
};

function Bars({ rows, unit, better = 'less' }: { rows: [string, number, boolean][]; unit: string; better?: 'less' | 'more' }) {
  const max = Math.max(...rows.map((r) => r[1]));
  return (
    <div className="ai__bars">
      {rows.map(([k, v, ours]) => (
        <div key={k} className="ai__bar">
          <span className="small">{k}</span>
          <div className="ai__track"><i className={ours ? 'ours' : ''} style={{ width: `${(v / max) * 100}%` }} /></div>
          <b className={ours ? 'ours' : ''}>{f1(v)}{unit}</b>
        </div>
      ))}
      <p className="muted small">{better === 'less' ? 'Меньше — лучше.' : 'Больше — лучше.'}</p>
    </div>
  );
}

export function AIScreen({ onClose }: { onClose: () => void }) {
  const m = ML_INFO.metrics as Record<string, { mae_tree: number; mae_persistence: number; top_features?: [string, number][] }>;
  const all = (arrivals as any).groups.all.all, tight = (arrivals as any).groups.tight['у ближайшей сейчас 1–3 места (или ни одного)'];
  const ev = useMemo(() => compareEvent(DEFAULT_EVENT), []);
  const top = m['15'].top_features ?? [];
  return (
    <Modal onClose={onClose} label="Как работает ИИ в Parkly" wide>
      <div className="ai">
        <h2 className="modal__title"><Icon name="flask" size={18} /> Как работает ИИ в Parkly</h2>
        <p className="muted small">Все модели работают прямо в телефоне, без сервера. Ниже — их проверка на данных, которых они не видели при обучении.</p>

        <section className="ai__card">
          <h3>1. Прогноз свободных мест — машинное обучение</h3>
          <p className="small">Деревья решений (scikit-learn) с квантилями: сколько мест будет через 5, 10 и 15 минут и с каким разбросом. Обучены на Python ({ML_INFO.data}), {ML_INFO.trainedAt}.</p>
          <p className="small"><b>Ошибка прогноза через 15 минут</b> (MAE, мест):</p>
          <Bars unit="" rows={[['«Как сейчас»', m['15'].mae_persistence, false], ['Модель Parkly', m['15'].mae_tree, true]]} />
          <p className="small">Через 5 мин: {f1(m['5'].mae_tree)} против {f1(m['5'].mae_persistence)}; через 10 мин: {f1(m['10'].mae_tree)} против {f1(m['10'].mae_persistence)}.</p>
          <p className="small"><b>Что модель считает важным:</b> {top.slice(0, 4).map(([k, v]) => `${FEAT_RU[k] ?? k} ${Math.round(v * 100)}%`).join(', ')}.</p>
          <p className="muted small">В карточке парковки — «Почему ИИ так решил»: настоящий путь модели к этому прогнозу.</p>
        </section>

        <section className="ai__card">
          <h3>2. Польза для водителя</h3>
          <p className="small">{all.n.toLocaleString('ru-RU')} тестовых сценариев ({(arrivals as any).days} дней): сколько раз водитель приезжает на полную парковку.</p>
          <Bars unit="%" rows={[['Ближайшая с местами сейчас', (all.fullA / all.n) * 100, false], ['Выбор Parkly', (all.fullB / all.n) * 100, true]]} />
          <p className="small">Когда у ближайшей парковки 0–3 места: <b>{pc(tight.fullA, tight.n)} → {pc(tight.fullB, tight.n)}</b>. Цена — {f1((all.walkB - all.walkA) / all.n)} мин пешком в среднем.</p>
        </section>

        <section className="ai__card">
          <h3>3. Распределение потока «после мероприятия»</h3>
          <p className="small">Тот же прогноз, но с учётом машин, которые уже выбрали парковку. {DEFAULT_EVENT.cars} машин у театра Абая, приехали на полную:</p>
          <Bars unit="%" rows={[['Каждому отдельно', ev.a.fullShare * 100, false], ['С учётом выбравших', ev.b.fullShare * 100, true]]} />
        </section>

        <section className="ai__card">
          <h3>4. Пин понимает речь и текст</h3>
          <p className="small">Голос — системное распознавание речи. Текст: опечатки, падежи, казахские буквы и латиница, микрорайоны и ЖК (≈23 тыс. мест из OSM), уточнения «а поближе?», «тогда до 700».</p>
          {AI_EXTRA.intent}
        </section>
        {AI_EXTRA.vision}

        <p className="note">Честно: прогноз обучен на симуляции загрузки демо-парковок, а не на городских датчиках. Импорт реальных замеров (CSV) уже есть — следующий шаг пилот с ТРЦ.</p>
      </div>
    </Modal>
  );
}
