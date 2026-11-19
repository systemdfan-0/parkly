import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import type { Place } from '../data/places';
import { catalogLot, loadIndex, catalogNear, indexSync, distM, type CatalogIndex, type CatalogLot } from '../catalog/data';
import { catalogFor, suitable, feeText, accessText, capText, lotTitle, NO_DATA, CAT_KIND_LABEL, type CatOption, type CatResult } from '../catalog/rank';
import { fmtDist } from '../engine/geo';
import { tenge } from '../engine/pricing';
import { useMap } from '../mapState';
import { Modal } from './Modal';
import { Icon } from './Icon';
import { navLink } from '../nav';
import { ParkedHere } from './Car';
import { MeasurementLine } from './Measurement';

const fmtDate = (s: string) => { const [d] = s.split(' '); const [y, m, dd] = d.split('-'); return `${dd}.${m}.${y}`; };
const n = (x: number) => x.toLocaleString('ru-RU').replace(/,/g, ' ');

/** Подбор из каталога OSM для места назначения (асинхронно: ячейки грузятся с диска). */
export function useCatalogResult(place: Place | null, enabled: boolean): { state: 'idle' | 'loading' | 'ready' | 'error'; r: CatResult | null } {
  const priority = useStore((s) => s.priority);
  const budget = useStore((s) => s.budget);
  const [st, setSt] = useState<{ key: string; state: 'loading' | 'ready' | 'error'; r: CatResult | null }>({ key: '', state: 'loading', r: null });
  const key = place && enabled ? `${place.lat},${place.lon}|${priority}|${budget}` : '';
  useEffect(() => {
    if (!place || !enabled) return;
    let live = true;
    setSt((s) => ({ key, state: 'loading', r: s.key.split('|')[0] === key.split('|')[0] ? s.r : null }));
    catalogFor(place, priority, budget).then((r) => { if (live) setSt({ key, state: 'ready', r }); }, () => { if (live) setSt({ key, state: 'error', r: null }); });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!key) return { state: 'idle', r: null };
  return { state: st.state, r: st.r };
}

export function SourceLine() {
  const [ix, setIx] = useState<CatalogIndex | null>(indexSync());
  useEffect(() => { if (!ix) loadIndex().then(setIx, () => {}); }, [ix]);
  if (!ix) return null;
  return <>OpenStreetMap (Geofabrik), данные на {fmtDate(ix.source.extractDate)}, ODbL</>;
}

export function CatCard({ o, selected, onClick, rank }: { o: CatOption; selected: boolean; onClick: () => void; rank?: number }) {
  const l = o.lot;
  const fee = feeText(l);
  return (
    <button className={`card card--cat ${selected ? 'card--sel' : ''} ${o.tags.includes('best') ? 'card--best' : ''} ${o.inBudget === true ? '' : 'card--off'}`} onClick={onClick}
      aria-label={`${o.title}, ${fmtDist(o.distM)}`}>
      <div className="card__tags">
        {rank != null && <span className="tag tag--num">{rank}</span>}
        {o.tags.includes('best') && <span className="tag tag--best">Лучший выбор</span>}
        {o.tags.includes('closest') && <span className="tag tag--closest">Ближе ко входу</span>}
        {o.tags.includes('free') && <span className="tag tag--cheapest">Бесплатно</span>}
        {l.access === 'private' && <span className="tag tag--off">Частная</span>}
        {l.access === 'customers' && <span className="tag tag--plain">Для клиентов</span>}
        {o.inBudget === null && <span className="tag tag--plain">Цена не указана</span>}
        {o.inBudget === false && <span className="tag tag--off">Дороже бюджета</span>}
        <span className="tag tag--osm">OSM</span>
      </div>
      <div className="card__name">{o.title}</div>
      <div className="card__metrics">
        <span><Icon name="walk" size={16} /><b>{o.walkMin}</b><small>мин пешком, {fmtDist(o.distM)}</small></span>
        <span><Icon name="wallet" size={16} /><b className={fee === NO_DATA ? 'nodata' : ''}>{o.perHour === 0 ? '0' : o.perHour != null ? o.perHour : '—'}</b><small>{o.perHour === 0 ? 'бесплатно' : o.perHour != null ? '₸ в час' : fee === NO_DATA ? 'цена: нет данных' : 'платно, сумма не указана'}</small></span>
        <span><Icon name="car" size={16} /><b className={l.cap == null ? 'nodata' : ''}>{l.cap ?? '—'}</b><small>{l.cap != null ? 'мест всего' : 'мест: нет данных'}</small></span>
      </div>
      <p className="card__why muted">Занятость: нет данных — к этой парковке не подключены датчики.</p>
    </button>
  );
}

export function CatalogResults({ place, r, state, compact }: { place: Place; r: CatResult | null; state: string; compact?: boolean }) {
  const selectLot = useStore((s) => s.selectLot);
  const selectedId = useStore((s) => s.selectedLotId);
  const budget = useStore((s) => s.budget);
  const setBudget = useStore((s) => s.setBudget);
  const [more, setMore] = useState(false);
  if (state === 'error') return <div className="empty"><h2>Каталог не открылся</h2><p className="muted">Файлы каталога лежат в приложении. Перезапустите Parkly.</p></div>;
  if (!r) return <div className="skeleton" aria-label="Ищу парковки в каталоге"><span /><span /><span /></div>;
  const ok = r.options.filter((o) => o.inBudget === true);
  const pub = r.options.filter((o) => o.lot.access !== 'private');
  const priv = r.options.filter((o) => o.lot.access === 'private');
  const list = compact && !more ? pub.slice(0, 3) : pub.slice(0, 40);
  return (
    <div className="results">
      {!compact && (
        <div className="results__head">
          <h2>Парковки у «{place.name}»</h2>
          <p className="muted">{r.options.length ? `${r.options.length} в каталоге OSM в ${fmtDist(r.radius)}` : `В каталоге OSM нет парковок в ${fmtDist(r.radius)}`}</p>
        </div>
      )}
      {compact && r.options.length > 0 && <h3 className="results__sub">Ещё рядом — из каталога OSM ({r.options.length})</h3>}
      {budget != null && (
        <div className="chips"><button className="chip chip--on" onClick={() => setBudget(null)}>{budget === 0 ? 'Только бесплатные' : `До ${tenge(budget)} в час`} <Icon name="x" size={14} /></button></div>
      )}
      {!r.options.length && !compact && (
        <div className="empty">
          <p>OpenStreetMap не знает парковок рядом с этим местом. Выберите точку ближе к центру или напишите Пину другое место.</p>
        </div>
      )}
      {budget != null && !ok.length && r.options.length > 0 && (
        <div className="banner banner--warn"><Icon name="info" size={18} /><span>Ни у одной парковки рядом цена не подходит или не указана. <button className="link" onClick={() => setBudget(null)}>Показать без учёта цены</button></span></div>
      )}
      {r.expanded && (
        <div className="banner banner--info"><Icon name="info" size={18} /><span>В {fmtDist(r.expanded.from)} {r.expanded.why} — расширил поиск до {fmtDist(r.radius)}.</span></div>
      )}
      {!r.options.some(suitable) && r.options.length > 0 && r.searched && (
        <div className="banner banner--warn"><Icon name="info" size={18} /><span>Искал до {fmtDist(r.searched)}: открытых для всех{budget != null ? ' и в бюджете' : ''} парковок нет. Ниже — ближайшие, что есть.</span></div>
      )}
      <div className="results__list">
        {list.map((o, i) => <CatCard key={o.lot.id} o={o} rank={!compact && i < 9 ? i + 1 : undefined} selected={o.lot.id === selectedId} onClick={() => selectLot(o.lot.id)} />)}
      </div>
      {priv.length > 0 && (!compact || more) && (
        <>
          <h3 className="results__sub">Частные — нужен пропуск ({priv.length})</h3>
          <p className="muted small">В OpenStreetMap у них отмечен ограниченный доступ: жильцы, сотрудники или по пропуску.</p>
          <div className="results__list">
            {priv.slice(0, 10).map((o) => <CatCard key={o.lot.id} o={o} selected={o.lot.id === selectedId} onClick={() => selectLot(o.lot.id)} />)}
          </div>
        </>
      )}
      {compact && (pub.length > 3 || priv.length > 0) && !more && <button className="btn btn--ghost btn--sm btn--full" onClick={() => setMore(true)}>Показать все {r.options.length}</button>}
      {!compact && <p className="note">Цены, доступ и вместимость — из OpenStreetMap; если тега нет, пишем «Нет данных». Занятость и прогноз для этих парковок не считаем: датчиков нет. Источник: <SourceLine />.</p>}
    </div>
  );
}

export function CatalogDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const destination = useStore((s) => s.destination);
  const [lot, setLot] = useState<CatalogLot | null>(catalogLot(id));
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (lot) return;
    // после перезапуска ячейка ещё не загружена — догружаем район вокруг назначения
    const v = useMap.getState().view;
    const at = destination ?? (v ? { lat: v.lat, lon: v.lon } : null);
    if (!at) { setMissing(true); return; }
    catalogNear(at.lat, at.lon, 3000).then(() => { const l = catalogLot(id); if (l) setLot(l); else setMissing(true); }, () => setMissing(true));
  }, [id, lot, destination]);
  if (!lot) return missing ? <div className="empty"><p>Парковка не найдена в каталоге.</p><button className="btn btn--dark" onClick={onBack}>Назад</button></div> : <div className="skeleton"><span /><span /></div>;

  const d = destination && destination.kind !== 'city' ? distM(destination.lat, destination.lon, lot.lat, lot.lon) : null;
  const osmUrl = `https://www.openstreetmap.org/${lot.osm[0] === 'n' ? 'node' : lot.osm[0] === 'w' ? 'way' : 'relation'}/${lot.osm.slice(1)}`;
  const nav = navLink({ lat: lot.lat, lon: lot.lon, entr: lot.entr, label: lotTitle(lot) });
  const rows: [string, string][] = [
    ['Цена', feeText(lot)],
    ['Доступ', accessText(lot)],
    ['Вместимость', capText(lot)],
    ['Тип', lot.kind ? CAT_KIND_LABEL[lot.kind] : NO_DATA],
    ['Часы работы', lot.hours || NO_DATA],
    ['Въезд', lot.entr ? 'Отмечен в OSM' : NO_DATA],
    ['Оператор', lot.op || NO_DATA],
    ['Занятость сейчас', NO_DATA],
    ['Прогноз к приезду', 'Не считаем: нет данных о занятости'],
  ];
  return (
    <div className="detail">
      <div className="detail__top">
        <button className="icon-btn icon-btn--dark" onClick={onBack} aria-label="Назад к списку"><Icon name="back" /></button>
        <div className="detail__title">
          <div className="card__tags"><span className="tag tag--osm">Каталог OSM</span>{lot.access === 'private' && <span className="tag tag--off">Частная</span>}</div>
          <h2>{lotTitle(lot)}</h2>
          <p className="muted">{d != null && destination ? `${fmtDist(d)} до «${destination.name}»` : ''}{lot.area ? `${d != null ? ' · ' : ''}площадь ≈ ${n(Math.round(lot.area / 10) * 10)} м²` : ''}</p>
        </div>
      </div>
      {lot.access === 'private' && <div className="banner banner--warn"><Icon name="info" size={18} /><span>В OSM отмечена как частная: въезд по пропуску. В подборе Пин ставит её ниже и предупреждает.</span></div>}
      <MeasurementLine lotId={lot.id} />
      <dl className="facts">
        {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className={v === NO_DATA ? 'nodata' : ''}>{v}</dd></div>)}
      </dl>
      <div className="row">
        <a className="btn btn--primary btn--grow" href={nav.href} target="_blank" rel="noreferrer"><Icon name="route" size={18} /> {nav.text}</a>
        <a className="btn btn--ghost" href={osmUrl} target="_blank" rel="noreferrer">OSM</a>
      </div>
      <ParkedHere lat={lot.lat} lon={lot.lon} name={lotTitle(lot)} id={lot.id} />
      <p className="note">{nav.toEntrance ? 'Навигатор ведёт к въезду, отмеченному в OSM. ' : 'Въезд в OSM не отмечен — навигатор ведёт к центру парковки. '}Бронь недоступна: это парковка из открытого каталога, а не демо-партнёр Parkly. Источник: <SourceLine />, объект {lot.osm}.</p>
    </div>
  );
}

/** Выбран город: что о нём знает каталог. */
export function CityView({ place }: { place: Place }) {
  const [ix, setIx] = useState<CatalogIndex | null>(indexSync());
  useEffect(() => { if (!ix) loadIndex().then(setIx, () => {}); }, [ix]);
  const c = ix?.cities[+place.id.slice(5)];
  if (!ix || !c) return <div className="skeleton"><span /><span /></div>;
  const reg = ix.regions[c.region];
  return (
    <div className="results">
      <div className="results__head">
        <h2>{c.ru}{c.kk && c.kk !== c.ru ? <span className="muted"> · {c.kk}</span> : null}</h2>
        <p className="muted">{reg && reg.ru !== c.ru ? reg.ru : 'Город республиканского значения'}</p>
      </div>
      <div className="stat3">
        <div><b>{n(c.lots)}</b><small>парковок в каталоге</small></div>
        <div><b>{n(c.poi)}</b><small>мест для поиска</small></div>
        <div><b>0</b><small>с данными о занятости</small></div>
      </div>
      <p>Напишите Пину, куда едете, или найдите место в поиске сверху. Метки на карте — парковки из OpenStreetMap; приблизьте карту, чтобы увидеть их по одной.</p>
      <p className="note">Источник: <SourceLine />.</p>
    </div>
  );
}

/** Покрытие каталога по областям и городам — фактические числа из импорта. */
export function Coverage({ onClose }: { onClose: () => void }) {
  const [ix, setIx] = useState<CatalogIndex | null>(indexSync());
  const [q, setQ] = useState('');
  useEffect(() => { if (!ix) loadIndex().then(setIx, () => {}); }, [ix]);
  const cities = useMemo(() => (ix ? [...ix.cities].filter((c) => c.lots > 0).sort((a, b) => b.lots - a.lots) : []), [ix]);
  if (!ix) return <Modal onClose={onClose} label="Покрытие каталога" wide><p>Загружаю…</p></Modal>;
  const s = ix.stats;
  const pct = (a: number) => `${Math.round((100 * a) / s.lots)}%`;
  const regs = [...ix.regions].sort((a, b) => b.lots - a.lots);
  const max = regs[0]?.lots ?? 1;
  const ql = q.trim().toLowerCase();
  const shown = ql ? cities.filter((c) => [c.ru, c.kk, c.en, ...c.alt].some((x) => x.toLowerCase().includes(ql))) : cities.slice(0, 25);
  const flyTo = useMap.getState().flyTo;
  return (
    <Modal onClose={onClose} label="Покрытие каталога парковок" wide>
      <h2 className="modal__title"><Icon name="map" size={18} /> Каталог парковок Казахстана</h2>
      <p className="muted small">{ix.source.name}. Данные OSM на {fmtDate(ix.source.extractDate)} (UTC), файл {ix.source.file}, MD5 {ix.source.md5Verified ? 'сверен' : 'не сверен'}. Лицензия {ix.source.license}. Импорт: {ix.source.importedAt}.</p>
      <div className="stat3">
        <div><b>{n(s.lots)}</b><small>парковок</small></div>
        <div><b>{n(cities.length)}</b><small>населённых пунктов</small></div>
        <div><b>{ix.regions.length}</b><small>регионов</small></div>
      </div>
      <h3>Что известно</h3>
      <dl className="facts facts--tight">
        <div><dt>Цена или «бесплатно»</dt><dd>{n(s.fee_known)} · {pct(s.fee_known)}</dd></div>
        <div><dt>Вместимость</dt><dd>{n(s.capacity)} · {pct(s.capacity)}</dd></div>
        <div><dt>Доступ</dt><dd>{n(s.lots - (s.access.unknown ?? 0))} · {pct(s.lots - (s.access.unknown ?? 0))}</dd></div>
        <div><dt>Частные</dt><dd>{n(s.access.private ?? 0)}</dd></div>
        <div><dt>Название</dt><dd>{n(s.named)} · {pct(s.named)}</dd></div>
        <div><dt>Занятость в реальном времени</dt><dd className="nodata">0 — нет данных</dd></div>
      </dl>
      <h3>По областям</h3>
      <ul className="bars">
        {regs.map((r) => (
          <li key={r.i}><span>{r.ru}</span><i style={{ width: `${Math.max(2, (100 * r.lots) / max)}%` }} /><b>{n(r.lots)}</b></li>
        ))}
      </ul>
      <h3>По городам</h3>
      <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти город: Қарағанды, Өскемен…" aria-label="Найти город" />
      <ul className="bars bars--cities">
        {shown.map((c) => (
          <li key={c.i}><button className="link" onClick={() => { flyTo(c.lat, c.lon, 12); onClose(); }}>{c.ru}</button><span className="muted small">{c.kk && c.kk !== c.ru ? c.kk : ''}</span><b>{n(c.lots)}</b></li>
        ))}
        {!shown.length && <li className="muted">Такого города нет среди {n(cities.length)} населённых пунктов с парковками.</li>}
      </ul>
      <p className="note">Пересобрать каталог из свежей выгрузки: <code>npm run catalog</code>. Гаражные кооперативы исключены ({s.excluded_garage_boxes}).</p>
    </Modal>
  );
}
