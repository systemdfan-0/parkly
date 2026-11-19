// Маршрут в карточке парковки — как в 2ГИС: вкладки «На машине» (до въезда, с пробками) и «Пешком» (от парковки до входа).
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { getRoute, fmtDur, jamShare, JAM_COLOR, get2gisKey, set2gisKey, check2gisKey, type Route, type RouteMode } from '../route/route';
import { useMap } from '../mapState';
import { useStore } from '../store';
import { ALMATY_BOUNDS, type Place } from '../data/places';
import { fmtDist } from '../engine/geo';
import { Icon } from './Icon';

/** Что сейчас нарисовано на карте: маршруты для выбранной парковки. */
interface RouteView { lotId: string | null; car: Route | null; walk: Route | null; mode: RouteMode; set: (p: Partial<RouteView>) => void }
export const useRoute = create<RouteView>()((set) => ({ lotId: null, car: null, walk: null, mode: 'walk', set: (p) => set(p) }));

const inAlmaty = (p: { lat: number; lon: number }) => p.lat > ALMATY_BOUNDS.south && p.lat < ALMATY_BOUNDS.north && p.lon > ALMATY_BOUNDS.west && p.lon < ALMATY_BOUNDS.east;
const SRC: Record<Route['source'], string> = {
  '2gis': '2ГИС', osm: 'OpenStreetMap, без пробок', line: 'по прямой — нет сети',
};

interface Props { lotId: string; lot: { lat: number; lon: number; entr?: [number, number] | null }; dest: Place | null }

export function RoutePanel({ lotId, lot, dest }: Props) {
  const geo = useMap((s) => s.geo);
  const origin = useStore((s) => s.origin);
  const { mode, car, walk, set } = useRoute();
  const [busy, setBusy] = useState(false);
  const target = lot.entr ? { lat: lot.entr[0], lon: lot.entr[1] } : lot;
  const hasDest = !!dest && dest.kind !== 'city';
  // откуда едем: геопозиция; без неё в демо Алматы — демо-точка отправления; в другом городе — просим геопозицию
  const from = geo.status === 'ok' && geo.lat != null ? { lat: geo.lat, lon: geo.lon!, me: true } : inAlmaty(lot) ? { lat: origin.lat, lon: origin.lon, me: false } : null;

  // пешком: от парковки до места назначения; без него — от вас (геопозиция) до парковки
  const me = geo.status === 'ok' && geo.lat != null ? { lat: geo.lat, lon: geo.lon! } : null;
  const walkFrom = hasDest ? lot : me, walkTo = hasDest ? dest! : lot;
  useEffect(() => { set({ lotId, car: null, walk: null, mode: hasDest ? 'walk' : 'car' }); }, [lotId]); // eslint-disable-line react-hooks/exhaustive-deps
  // пешком с местом назначения — сразу (1 запрос); остальное — когда открыли вкладку (экономия лимита 2ГИС)
  useEffect(() => {
    if (!walkFrom || (!hasDest && mode !== 'walk')) return;
    let live = true;
    setBusy(true);
    getRoute('walk', walkFrom, walkTo).then((r) => live && set({ walk: r })).finally(() => live && setBusy(false));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotId, dest?.id, mode, walkFrom?.lat, walkFrom?.lon]);
  useEffect(() => {
    if (mode !== 'car' || !from) return;
    let live = true;
    setBusy(true);
    getRoute('car', from, target).then((r) => live && set({ car: r })).finally(() => live && setBusy(false));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, lotId, from?.lat, from?.lon, target.lat, target.lon]);
  useEffect(() => () => useRoute.setState({ lotId: null, car: null, walk: null }), [lotId]);

  const r = mode === 'car' ? car : walk;
  // «Включить пробки» — сразу к полю ключа в «Избранное»
  const openKey = () => { useStore.getState().setTab('saved'); setTimeout(() => document.getElementById('traffic-key')?.scrollIntoView({ block: 'center' }), 250); };
  const share = r && r.mode === 'car' && r.source === '2gis' ? jamShare(r) : null;
  const extra = r && r.usualS != null ? Math.round((r.durS - r.usualS) / 60) : 0;

  return (
    <section className="route" aria-label="Маршрут">
      <div className="route__tabs" role="tablist">
        <button role="tab" aria-selected={mode === 'car'} className={mode === 'car' ? 'on' : ''} onClick={() => set({ mode: 'car' })}>
          <Icon name="car" size={18} /> На машине{car ? <b>{fmtDur(car.durS)}</b> : null}
        </button>
        <button role="tab" aria-selected={mode === 'walk'} className={mode === 'walk' ? 'on' : ''} onClick={() => set({ mode: 'walk' })}>
          <Icon name="walk" size={18} /> Пешком{walk ? <b>{fmtDur(walk.durS)}</b> : null}
        </button>
      </div>
      {mode === 'car' && !from && (
        <div className="route__body">
          <p className="muted small">Чтобы построить маршрут на машине, нужна ваша геопозиция.</p>
          <button className="btn btn--dark btn--sm" onClick={() => void useMap.getState().locate()}><Icon name="locate" size={16} /> Определить, где я</button>
        </div>
      )}
      {mode === 'walk' && !walkFrom && (
        <div className="route__body">
          <p className="muted small">Покажу, сколько идти от вас до парковки — нужна геопозиция. Или выберите место назначения: путь от парковки до входа.</p>
          <button className="btn btn--dark btn--sm" onClick={() => void useMap.getState().locate()}><Icon name="locate" size={16} /> Определить, где я</button>
        </div>
      )}
      {((mode === 'car' && from) || (mode === 'walk' && walkFrom)) && (
        <div className="route__body">
          {!r && busy && <p className="muted small">Строю маршрут…</p>}
          {r && (
            <>
              <p className="route__main"><b>{fmtDur(r.durS)}</b> · {fmtDist(r.distM)}
                {mode === 'car' && r.source === '2gis' && <span className="route__live">с пробками сейчас</span>}</p>
              <p className="muted small">
                {mode === 'car'
                  ? `${from?.me ? 'От вас' : `От «${origin.name}» (демо)`} до ${lot.entr ? 'въезда' : 'парковки'}`
                  : hasDest ? `От парковки до «${dest!.name}» по тротуарам` : `От вас до ${lot.entr ? 'въезда парковки' : 'парковки'} пешком, по тротуарам`}
                {r.usualS != null && Math.abs(extra) >= 1 ? ` · обычно в это время ${fmtDur(r.usualS)}${extra > 0 ? `, пробки +${extra} мин` : ''}` : ''}
              </p>
              {share && (
                <>
                  <div className="route__jam" aria-label="Загруженность по пути">
                    {(['fast', 'normal', 'slow', 'jam'] as const).map((k) => share[k] > 0.005 && <i key={k} style={{ width: `${share[k] * 100}%`, background: JAM_COLOR[k] }} />)}
                  </div>
                  <p className="route__legend small"><span><i style={{ background: JAM_COLOR.fast }} />свободно</span><span><i style={{ background: JAM_COLOR.slow }} />плотно</span><span><i style={{ background: JAM_COLOR.jam }} />пробка</span></p>
                </>
              )}
              <p className="route__src small muted">Маршрут: {SRC[r.source]}{r.source === '2gis' && mode === 'car' ? ', пробки сейчас' : ''}.</p>
              {mode === 'car' && (!get2gisKey() || !from?.me) && (
                <div className="row">
                  {!get2gisKey() && <button className="btn btn--dark btn--sm" onClick={openKey}>Включить пробки 2ГИС</button>}
                  {!from?.me && <button className="btn btn--ghost btn--sm" onClick={() => void useMap.getState().locate()}><Icon name="locate" size={16} /> Построить от меня</button>}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** Ключ 2ГИС: хранится только на телефоне. Без ключа маршруты строятся по OpenStreetMap, без пробок. */
export function TrafficKeySection() {
  const [has, setHas] = useState(!!get2gisKey());
  const [val, setVal] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const v = val.trim();
    if (!set2gisKey(v)) { setMsg('Это не похоже на ключ 2ГИС: нужен вид xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.'); return; }
    setBusy(true); setMsg('Проверяю ключ…');
    const r = await check2gisKey(v);
    setBusy(false);
    if (r === 'bad') { set2gisKey(null); setHas(false); setMsg('2ГИС не принял ключ. Проверьте, что в нём включён Routing API.'); return; }
    setHas(true); setVal('');
    setMsg(r === 'ok' ? 'Готово: маршруты на машине — с пробками 2ГИС.' : 'Ключ сохранён. Проверить не удалось — нет сети.');
  };
  return (
    <div className="appinfo" id="traffic-key">
      <p><b>Пробки 2ГИС</b> <span className={`tag ${has ? 'tag--on' : 'tag--off'}`}>{has ? 'включены' : 'выключены'}</span></p>
      <p className="muted small">Маршрут на машине с учётом пробок сейчас. Ключ хранится только на этом телефоне; в 2ГИС уходят лишь точки маршрута.</p>
      {has ? (
        <div className="row"><button className="btn btn--ghost btn--sm" onClick={() => { set2gisKey(null); setHas(false); setMsg('Ключ удалён. Маршруты — по OpenStreetMap, без пробок.'); }}>Удалить ключ</button></div>
      ) : (
        <div className="row">
          <input className="car__note" value={val} onChange={(e) => setVal(e.target.value)} placeholder="Ключ API 2ГИС" aria-label="Ключ API 2ГИС" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
          <button className="btn btn--dark btn--sm" onClick={save} disabled={busy || !val.trim()}>Сохранить</button>
        </div>
      )}
      {msg && <p className="small">{msg}</p>}
    </div>
  );
}
