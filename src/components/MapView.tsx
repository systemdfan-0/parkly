import { useRoute } from './RoutePanel';
import { JAM_COLOR } from '../route/route';
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ALMATY_CENTER, DEMO_OSM, LOTS, LOT_BY_ID, type Place } from '../data/places';
import type { Result } from '../engine/recommend';
import { freeNow, isOpenAt } from '../engine/model';
import { levelOf } from '../format';
import { useStore } from '../store';
import { useMap } from '../mapState';
import { catalogLot, cellKeysIn, cellSync, isCatalogId, loadCell, loadIndex, type CatalogIndex, type CatalogLot } from '../catalog/data';
import type { CatResult } from '../catalog/rank';
import { Icon } from './Icon';
import { addBase } from '../mapBase';
import { useCar } from '../car/store';

// Схема главных улиц Алматы — если плитки карты не загрузились (нет интернета).
const SCHEMA: [number, number][][] = [
  [[43.2046, 76.859], [43.2105, 76.884], [43.216, 76.908], [43.2188, 76.929], [43.2235, 76.949], [43.229, 76.964]],
  [[43.239, 76.85], [43.24, 76.9], [43.2405, 76.958]],
  [[43.253, 76.85], [43.2555, 76.944], [43.2565, 76.958]],
  [[43.264, 76.85], [43.2665, 76.95], [43.267, 76.975]],
  [[43.235, 76.87], [43.2365, 76.92], [43.2375, 76.956]],
  [[43.266, 76.957], [43.24, 76.958], [43.23, 76.96], [43.22, 76.965]],
  [[43.27, 76.95], [43.238, 76.947], [43.219, 76.942]],
  [[43.272, 76.941], [43.25, 76.9425], [43.24, 76.943]],
  [[43.26, 76.897], [43.22, 76.895], [43.2, 76.892]],
  [[43.265, 76.858], [43.205, 76.854]],
  [[43.23, 76.965], [43.19, 77.01], [43.1574, 77.0587]],
];

/** Группировка точек по сетке в пикселях текущего масштаба (стабильна при сдвиге карты). */
export function gridCluster<T extends { lat: number; lon: number }>(pts: T[], project: (lat: number, lon: number) => { x: number; y: number }, cell: number) {
  const g = new Map<string, { items: T[]; lat: number; lon: number }>();
  for (const p of pts) {
    const q = project(p.lat, p.lon);
    const k = `${Math.floor(q.x / cell)}:${Math.floor(q.y / cell)}`;
    const c = g.get(k);
    if (c) { c.items.push(p); c.lat += p.lat; c.lon += p.lon; } else g.set(k, { items: [p], lat: p.lat, lon: p.lon });
  }
  return [...g.entries()].map(([k, c]) => ({ key: k, items: c.items, lat: c.lat / c.items.length, lon: c.lon / c.items.length }));
}

interface Props {
  results: Result | null;
  cat: CatResult | null;
  wide: boolean;
  padBottom: number;
  onPick: (lat: number, lon: number) => void;
  onSelect: (id: string) => void;
}

const KZ_BOUNDS = L.latLngBounds([38.5, 44], [57.5, 90]);

export function MapView({ results, cat, wide, padBottom, onPick, onSelect }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef(new Map<string, { m: L.Marker; html: string }>());
  const catMarkers = useRef(new Map<string, { m: L.Marker; html: string }>());
  const fixed = useRef<L.LayerGroup | null>(null);
  const walk = useRef<L.LayerGroup | null>(null);
  const [offline, setOffline] = useState(false);
  const [ix, setIx] = useState<CatalogIndex | null>(null);
  const [viewTick, setViewTick] = useState(0);
  const [cellsTick, setCellsTick] = useState(0);
  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect;
  const onPickRef = useRef(onPick); onPickRef.current = onPick;
  const padRef = useRef(padBottom); padRef.current = padBottom;

  const destination = useStore((s) => s.destination);
  const origin = useStore((s) => s.origin);
  const selectedId = useStore((s) => s.selectedLotId);
  const pinLotId = useStore((s) => s.pinLotId);
  const lineId = selectedId ?? pinLotId;
  const routeView = useRoute();
  const now = useStore((s) => s.sim.now);
  const occ = useStore((s) => s.sim.occ);
  const bookings = useStore((s) => s.bookings);
  const fly = useMap((s) => s.fly);
  const geo = useMap((s) => s.geo);
  const online = useMap((s) => s.online);
  const car = useCar((s) => s.car);
  const picking = useCar((s) => s.picking);

  const pads = () => ({
    paddingTopLeft: (wide ? [440, 40] : [24, 84]) as L.PointTuple,
    paddingBottomRight: (wide ? [40, 40] : [24, padRef.current + 16]) as L.PointTuple,
  });

  // инициализация
  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: false, attributionControl: true, minZoom: 4, maxZoom: 19, maxBounds: KZ_BOUNDS.pad(0.1), maxBoundsViscosity: 0.8, zoomSnap: 0.5 })
      .setView(ALMATY_CENTER, 13);
    m.attributionControl.setPrefix('');
    // векторная подложка OpenFreeMap (чёткая на любом экране) или растровые плитки OSM, если WebGL нет
    let alive = true;
    void addBase(m, { onLoad: () => setOffline(false), onError: () => setOffline(true) }, () => alive);
    if (!navigator.onLine) setOffline(true);
    const schema = L.layerGroup(SCHEMA.map((pts) => L.polyline(pts, { color: '#B9C2CC', weight: 5, interactive: false })));
    (m as unknown as { _schema: L.LayerGroup })._schema = schema;
    fixed.current = L.layerGroup().addTo(m);
    walk.current = L.layerGroup().addTo(m);
    m.on('contextmenu', (e: L.LeafletMouseEvent) => onPickRef.current(e.latlng.lat, e.latlng.lng));
    // «Где моя машина» → «Отметить на карте»: следующее касание ставит точку
    m.on('click', (e: L.LeafletMouseEvent) => { if (useCar.getState().picking) useCar.getState().pick(e.latlng.lat, e.latlng.lng); });
    const report = () => {
      const c = m.getCenter(), b = m.getBounds();
      useMap.getState().setView({ lat: c.lat, lon: c.lng, zoom: m.getZoom(), s: b.getSouth(), w: b.getWest(), n: b.getNorth(), e: b.getEast() });
      setViewTick((t) => t + 1);
    };
    m.on('moveend zoomend', report);
    report();
    map.current = m;
    loadIndex().then(setIx, () => {});
    return () => { alive = false; m.remove(); map.current = null; markers.current.clear(); catMarkers.current.clear(); };
  }, []);

  useEffect(() => { if (online && offline) setOffline(false); }, [online]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m = map.current; if (!m) return;
    const schema = (m as unknown as { _schema: L.LayerGroup })._schema;
    if (offline) schema.addTo(m); else schema.remove();
  }, [offline]);

  useEffect(() => { setTimeout(() => map.current?.invalidateSize(), 50); }, [wide]);

  // запрос «перелететь» (город, геолокация, покрытие)
  useEffect(() => {
    const m = map.current; if (!m || !fly) return;
    m.flyTo([fly.lat, fly.lon], fly.zoom ?? Math.max(m.getZoom(), 13), { duration: 0.7 });
  }, [fly]);

  // назначение, «вы здесь» (демо-точка отправления) и реальная геопозиция
  useEffect(() => {
    const g = fixed.current; if (!g) return;
    g.clearLayers();
    L.marker([origin.lat, origin.lon], {
      icon: L.divIcon({ className: 'mk', iconSize: [0, 0], html: `<div class="me me--demo"><span></span><em>Старт (демо)</em></div>` }),
      keyboard: false, zIndexOffset: 500, interactive: false,
    }).addTo(g);
    if (geo.status === 'ok' && geo.lat != null) {
      L.marker([geo.lat, geo.lon!], {
        icon: L.divIcon({ className: 'mk', iconSize: [0, 0], html: `<div class="me"><span></span><em>Вы здесь</em></div>` }),
        keyboard: false, zIndexOffset: 600, interactive: false,
      }).addTo(g);
    }
    if (car) {
      L.marker([car.lat, car.lon], {
        icon: L.divIcon({ className: 'mk', iconSize: [0, 0], html: `<div class="carmk" title="Моя машина"><svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="${CAR_PATH}"/></svg>${car.note ? `<em>${esc(car.note)}</em>` : ''}</div>` }),
        keyboard: false, zIndexOffset: 2500, interactive: false,
      }).addTo(g);
    }
    if (destination) {
      L.marker([destination.lat, destination.lon], {
        icon: L.divIcon({ className: 'mk', iconSize: [0, 0], html: destination.kind === 'city' || /^(me|view):/.test(destination.id) ? '' : `<div class="dest"><div class="dest__pin"></div><div class="dest__label">${esc(destination.name)}</div></div>` }),
        keyboard: false, zIndexOffset: 1000, interactive: false,
      }).addTo(g);
    }
  }, [destination, origin, geo, car]);

  // кадрирование при смене назначения: демо-варианты или первые варианты из каталога
  const catKey = cat ? cat.options.slice(0, 5).map((o) => o.lot.id).join(',') : '';
  useEffect(() => {
    const m = map.current; if (!m || !destination) return;
    if (destination.kind === 'city') { m.flyTo([destination.lat, destination.lon], 12, { duration: 0.7 }); return; }
    const pts: L.LatLngExpression[] = [[destination.lat, destination.lon]];
    if (results?.options.length) results.options.forEach((o) => pts.push([o.lot.lat, o.lot.lon]));
    else if (cat) cat.options.slice(0, 5).forEach((o) => pts.push([o.lot.lat, o.lot.lon]));
    const b = L.latLngBounds(pts);
    m.flyToBounds(b.pad(0.05), { ...pads(), maxZoom: 18, duration: 0.6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination?.id, destination?.lat, wide, catKey, !!results?.options.length]);

  // демо-подбор (Алматы): варианты с прогнозом — те же квадратные метки, что и у каталога, число = свободно сейчас
  useEffect(() => {
    const m = map.current; if (!m) return;
    const want = new Map<string, string>();
    if (results) {
      for (const o of results.options) {
        const lvl = o.available ? levelOf(o.fc.pFree, o.available) : 'off';
        want.set(o.lot.id, demoHtml(o.lot.name, lvl, o.available ? String(o.freeNow) : '×', o.lot.id === selectedId, o.lot.id === pinLotId && !selectedId, true));
      }
    }
    for (const [id, rec] of markers.current) if (!want.has(id)) { rec.m.remove(); markers.current.delete(id); }
    for (const [id, html] of want) {
      const lot = LOT_BY_ID[id];
      const rec = markers.current.get(id);
      const zi = id === selectedId || id === pinLotId ? 1900 : 1200;
      if (!rec) {
        const mk = L.marker([lot.lat, lot.lon], { icon: L.divIcon({ className: 'mk', iconSize: [0, 0], html }), zIndexOffset: zi, title: lot.name, alt: lot.name });
        mk.on('click', (e) => { pressed(e); onSelectRef.current(id); });
        mk.addTo(m);
        markers.current.set(id, { m: mk, html });
      } else if (rec.html !== html) {
        rec.m.setIcon(L.divIcon({ className: 'mk', iconSize: [0, 0], html }));
        rec.m.setZIndexOffset(zi);
        rec.html = html;
      }
    }
  }, [results, selectedId, pinLotId]);

  // каталог OSM: сетка-агрегаты при отдалении, точки и кластеры при приближении
  useEffect(() => {
    const m = map.current; if (!m || !ix) return;
    const z = m.getZoom();
    const b = m.getBounds().pad(0.25);
    const want = new Map<string, { lat: number; lon: number; html: string; onClick: () => void; z: number }>();
    const project = (lat: number, lon: number) => m.project([lat, lon], z);
    const zoomTo = (lat: number, lon: number, dz = 2) => () => m.flyTo([lat, lon], Math.min(18, z + dz), { duration: 0.45 });
    const ranked = new Map<string, number>();
    cat?.options.slice(0, 9).forEach((o, i) => ranked.set(o.lot.id, i + 1));

    const keys = cellKeysIn(ix, b.getSouth(), b.getWest(), b.getNorth(), b.getEast());
    const loadable = z >= 10 && keys.length <= 20;
    if (results?.options.length) {
      // демо-подбор Алматы: слой каталога не мешает меткам с прогнозом (каталог — списком ниже)
    } else if (!loadable) {
      // отдалённый вид: группы по квадратам каталога (без загрузки самих точек)
      const cells = ix.cells.filter((c) => b.contains([c.lat, c.lon]));
      for (const g of gridCluster(cells, project, 84)) {
        const n = g.items.reduce((a, c) => a + c.n, 0);
        want.set(`g:${z}:${g.key}`, { lat: g.lat, lon: g.lon, z: 100, onClick: zoomTo(g.lat, g.lon, z < 7 ? 3 : 2), html: clusterHtml(n) });
      }
    } else {
      const missing = keys.filter((k) => !cellSync(k));
      if (missing.length) Promise.all(missing.map(loadCell)).then(() => setCellsTick((t) => t + 1), () => {});
      // одна система меток: OSM-парковки и демо-парковки Алматы (демо стоят на тех же объектах OSM — их не дублируем)
      const pts: { id: string; lat: number; lon: number; html: string }[] = [];
      for (const k of keys) for (const l of cellSync(k) ?? []) {
        if (b.contains([l.lat, l.lon]) && !ranked.has(l.id) && l.id !== selectedId && !DEMO_OSM.has(l.osm)) pts.push({ id: l.id, lat: l.lat, lon: l.lon, html: catHtml(l) });
      }
      if (!cat) for (const lot of LOTS) {
        if (!b.contains([lot.lat, lot.lon]) || lot.id === selectedId) continue;
        const open = isOpenAt(lot, now);
        const f = freeNow(lot, occ[lot.id] ?? 0, now, bookings);
        const lvl = !open ? 'off' : f >= Math.max(3, lot.capacity * 0.08) ? 'ok' : f > 0 ? 'tight' : 'full';
        pts.push({ id: lot.id, lat: lot.lat, lon: lot.lon, html: demoHtml(`${lot.name} (демо): ${open ? 'свободно ' + f : 'закрыта'}`, lvl, 'P', false, lot.id === pinLotId) });
      }
      if (z >= 16) {
        for (const l of pts) want.set(l.id, { lat: l.lat, lon: l.lon, z: 200, onClick: () => onSelectRef.current(l.id), html: l.html });
      } else {
        for (const g of gridCluster(pts, project, z >= 15 ? 52 : z >= 13 ? 84 : 92)) {
          if (g.items.length === 1) { const l = g.items[0]; want.set(l.id, { lat: l.lat, lon: l.lon, z: 200, onClick: () => onSelectRef.current(l.id), html: l.html }); }
          else want.set(`c:${z}:${g.key}:${g.items.length}`, { lat: g.lat, lon: g.lon, z: 150, onClick: zoomTo(g.lat, g.lon), html: clusterHtml(g.items.length, true) });
        }
      }
    }
    // варианты подбора и выбранная парковка — всегда отдельными метками поверх групп
    for (const [id, rank] of ranked) {
      const l = catalogLot(id); if (!l) continue;
      want.set(`r:${id}`, { lat: l.lat, lon: l.lon, z: id === selectedId ? 2000 : 1500 - rank, onClick: () => onSelectRef.current(id), html: catHtml(l, rank, id === selectedId) });
    }
    if (isCatalogId(selectedId) && !ranked.has(selectedId)) {
      const l = catalogLot(selectedId);
      if (l) want.set(`r:${selectedId}`, { lat: l.lat, lon: l.lon, z: 2000, onClick: () => {}, html: catHtml(l, undefined, true) });
    } else if (selectedId && LOT_BY_ID[selectedId] && !results?.options.length) {
      const l = LOT_BY_ID[selectedId];
      want.set(`r:${selectedId}`, { lat: l.lat, lon: l.lon, z: 2000, onClick: () => {}, html: demoHtml(l.name, 'ok', 'P', true) });
    }

    const have = catMarkers.current;
    for (const [k, rec] of have) if (!want.has(k)) { rec.m.remove(); have.delete(k); }
    for (const [k, w] of want) {
      const rec = have.get(k);
      if (!rec) {
        const mk = L.marker([w.lat, w.lon], { icon: L.divIcon({ className: 'mk', iconSize: [0, 0], html: w.html }), zIndexOffset: w.z, keyboard: false });
        mk.on('click', (e) => { pressed(e); w.onClick(); });
        mk.addTo(m);
        have.set(k, { m: mk, html: w.html });
      } else {
        if (rec.html !== w.html) { rec.m.setIcon(L.divIcon({ className: 'mk', iconSize: [0, 0], html: w.html })); rec.html = w.html; }
        rec.m.off('click');
        rec.m.on('click', (e) => { pressed(e); w.onClick(); });
        rec.m.setZIndexOffset(w.z);
      }
    }
  }, [ix, viewTick, cellsTick, cat, selectedId, results, pinLotId, now, occ, bookings]);

  // пешеходная «разметка» от выбранной парковки до входа; выбранная парковка — в кадр
  useEffect(() => {
    const g = walk.current, m = map.current; if (!g || !m) return;
    g.clearLayers();
    if (!lineId) return;
    const lot = LOT_BY_ID[lineId] ?? catalogLot(lineId);
    if (!lot) return;
    const rv = routeView.lotId === lineId ? routeView : null;
    const carR = rv?.mode === 'car' ? rv.car : null;
    if (carR) {
      // маршрут на машине: подложка + участки цветом загруженности (2ГИС) или синий (OSM / по прямой)
      const all: L.LatLng[] = [];
      for (const sg of carR.segs) {
        L.polyline(sg.pts, { color: '#1E2229', weight: 10, opacity: 0.85, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(g);
        sg.pts.forEach(([la, lo]) => all.push(L.latLng(la, lo)));
      }
      for (const sg of carR.segs) {
        L.polyline(sg.pts, { color: sg.jam ? JAM_COLOR[sg.jam] : '#2F7BEA', weight: 6, lineCap: 'round', lineJoin: 'round', interactive: false,
          dashArray: carR.source === 'line' ? '10 10' : undefined }).addTo(g);
      }
      if (all.length) {
        L.circleMarker(all[0], { radius: 7, color: '#fff', weight: 3, fillColor: '#2F7BEA', fillOpacity: 1, interactive: false }).addTo(g);
        const b = L.latLngBounds(all);
        if (!m.getBounds().pad(-0.1).contains(b)) m.flyToBounds(b.pad(0.25), { ...pads(), maxZoom: 17, duration: 0.5 });
      }
    } else if (rv?.mode === 'walk' && rv.walk && !(destination && destination.kind !== 'city')) {
      // пешком от вас до парковки (без места назначения)
      const line = rv.walk.segs.flatMap((sg) => sg.pts);
      L.polyline(line, { color: '#262B33', weight: 8, opacity: 0.9, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(g);
      L.polyline(line, { color: '#FFD23F', weight: 3, dashArray: '7 9', lineCap: 'butt', lineJoin: 'round', interactive: false }).addTo(g);
      if (line.length) {
        L.circleMarker(line[0], { radius: 7, color: '#fff', weight: 3, fillColor: '#2F7BEA', fillOpacity: 1, interactive: false }).addTo(g);
        const b = L.latLngBounds(line);
        if (!m.getBounds().pad(-0.1).contains(b)) m.flyToBounds(b.pad(0.25), { ...pads(), maxZoom: 18, duration: 0.5 });
      }
    } else if (destination && destination.kind !== 'city') {
      // пешком: по тротуарам, если маршрут уже пришёл; пока нет — прямая разметка
      const wr = rv?.walk;
      const line: L.LatLngExpression[] = wr && wr.source !== 'line' ? wr.segs.flatMap((sg) => sg.pts) : [[lot.lat, lot.lon], [destination.lat, destination.lon]];
      if (wr && wr.source !== 'line') line.push([destination.lat, destination.lon]);
      L.polyline(line, { color: '#262B33', weight: 8, opacity: 0.9, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(g);
      L.polyline(line, { color: '#FFD23F', weight: 3, dashArray: '7 9', lineCap: 'butt', lineJoin: 'round', interactive: false }).addTo(g);
      const b = L.latLngBounds(line);
      if (!m.getBounds().pad(-0.15).contains(b)) m.flyToBounds(b.pad(0.4), { ...pads(), maxZoom: 18, duration: 0.5 });
    } else {
      // без назначения (из поиска по карте): просто показать метку над панелью
      const p = m.latLngToContainerPoint([lot.lat, lot.lon]);
      const h = m.getSize().y;
      const w = m.getSize().x, target = (84 + (h - padRef.current)) / 2;
      const dy = p.y > h - padRef.current - 30 || p.y < 90 ? p.y - target : 0;
      const dx = p.x < 40 || p.x > w - 40 ? p.x - w / 2 : 0;
      if (dx || dy) m.panBy([dx, dy], { duration: 0.4 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineId, destination, routeView]);

  const geoMsg = geo.status === 'denied' ? 'Нет доступа к геолокации. Разрешите его Parkly в настройках телефона или найдите место поиском.'
    : geo.status === 'unavailable' ? 'Не удалось определить местоположение: включите геолокацию на телефоне.'
      : geo.status === 'timeout' ? 'Геолокация не ответила за 12 секунд. Попробуйте ещё раз на улице.' : null;
  const [geoHidden, setGeoHidden] = useState(0);

  return (
    <div className={`map ${offline || !online ? 'map--offline' : ''}`}>
      <div ref={el} className="map__canvas" role="application" aria-label="Карта парковок Казахстана" />
      {picking && (
        <div className="map__pick" role="status">
          <span>Нажмите на карту там, где стоит машина</span>
          <button className="btn btn--ghost btn--sm" onClick={() => useCar.getState().setPicking(false)}>Отмена</button>
        </div>
      )}
      {(offline || !online) && <div className="map__offline" role="status">{online ? 'Подложка карты не загрузилась.' : 'Нет интернета.'} Каталог парковок, Пин и прогноз работают офлайн.</div>}
      {!wide && (
        <button className={`locate ${geo.status === 'asking' ? 'is-busy' : ''} ${geo.status === 'ok' ? 'is-on' : ''}`} aria-label="Где я"
          style={{ bottom: `calc(${padBottom + 10}px)` }}
          onClick={() => { setGeoHidden(0); void useMap.getState().locate(); }}>
          <Icon name="locate" size={22} />
        </button>
      )}
      {geoMsg && geoHidden === 0 && (
        <div className="map__geo" role="alert" style={{ bottom: `calc(${padBottom + 66}px)` }}>
          <Icon name="info" size={16} /><span>{geoMsg}</span>
          <button className="icon-btn" onClick={() => setGeoHidden(1)} aria-label="Скрыть"><Icon name="x" size={14} /></button>
        </div>
      )}
    </div>
  );
}

/** Мгновенная реакция на нажатие метки — до того, как React перерисует панель. */
function pressed(e: L.LeafletEvent) {
  const node = (e.target as L.Marker).getElement()?.firstElementChild as HTMLElement | null;
  if (!node) return;
  node.classList.add('is-press');
  setTimeout(() => node.classList.remove('is-press'), 260);
}

function clusterHtml(n: number, local = false) {
  const size = n >= 1000 ? 'xl' : n >= 100 ? 'l' : n >= 10 ? 'm' : 's';
  const label = n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace('.', ',')}k` : String(n);
  return `<div class="clu clu--${size} ${local ? 'clu--local' : ''}" title="Парковок в каталоге: ${n}"><b>${label}</b></div>`;
}

function catHtml(l: CatalogLot, rank?: number, sel = false) {
  const cls = ['cat', l.access === 'private' ? 'cat--private' : '', l.fee === 0 ? 'cat--free' : '', rank ? 'cat--rank' : '', sel ? 'is-sel' : ''].join(' ');
  return `<div class="${cls}" title="${esc(l.name || 'Парковка (OSM)')}"><b>${rank ?? 'P'}</b></div>`;
}

/** Демо-парковка: та же квадратная метка; цветная точка (или фон в подборе) — свободные места. */
function demoHtml(title: string, lvl: string, label: string, sel = false, pin = false, filled = false) {
  const cls = ['cat', 'cat--demo', filled ? `cat--fill cat--${lvl}` : '', sel ? 'is-sel' : '', pin ? 'is-pin' : ''].join(' ');
  return `<div class="${cls}" title="${esc(title)}"><b>${esc(label)}</b>${filled ? '' : `<i class="dot dot--${lvl}"></i>`}</div>`;
}

const CAR_PATH = 'M5 11 6.5 6.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11a2 2 0 0 1 1 1.7V18h-2v1.5a1 1 0 0 1-2 0V18H8v1.5a1 1 0 0 1-2 0V18H4v-5.3A2 2 0 0 1 5 11Zm2.1 0h9.8l-1.2-3.8H8.3ZM6.5 13a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm11 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z';

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export type { Place };
