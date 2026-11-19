import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore, type Tab } from './store';
import { useResults, useSelectedOption, useSimClock, useWide } from './hooks';
import { MapView } from './components/MapView';
import { SearchBar } from './components/SearchBar';
import { Results } from './components/Results';
import { LotDetail } from './components/LotDetail';
import { Confirm } from './components/Confirm';
import { Trips } from './components/Trips';
import { Saved } from './components/Saved';
import { Home } from './components/Home';
import { DemoPanel } from './components/DemoPanel';
import { Method } from './components/Method';
import { Toasts } from './components/Toasts';
import { Icon } from './components/Icon';
import { Pin, PinBar } from './components/Pin';
import { CatalogDetail, CatalogResults, CityView, Coverage, useCatalogResult } from './components/Catalog';
import { UpdateScreen, UpdateBanner } from './components/UpdateScreen';
import { EventDemo } from './components/EventDemo';
import { useUpdates } from './updates/store';
import { usePin } from './pinStore';
import { useKb } from './mapState';
import { isCatalogId } from './catalog/data';
import type { PinReply } from './engine/pinReply';
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';

type Snap = 'peek' | 'half' | 'full';
const TAB = 64;
const TOP = 76;      // строка поиска
const BAR = 58;      // поле «Спросить Пина»
const DOCK = 66;     // поле ввода внизу экрана Пина

function snapPx(s: Snap, H: number) {
  if (s === 'peek') return 150;
  if (s === 'half') return Math.round((H - TAB) * 0.5);
  return H - TAB - TOP - 8;
}

export default function App() {
  useSimClock();
  const wide = useWide();
  const results = useResults();
  const selected = useSelectedOption(results);
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const destination = useStore((s) => s.destination);
  const selectedId = useStore((s) => s.selectedLotId);
  const selectLot = useStore((s) => s.selectLot);
  const setDestination = useStore((s) => s.setDestination);
  const activeCount = useStore((s) => s.bookings.filter((b) => b.status === 'active').length);
  const [demo, setDemo] = useState(false);
  const [eventDemo, setEventDemo] = useState(false);
  const [method, setMethod] = useState(false);
  const [coverage, setCoverage] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const updScreen = useUpdates((s) => s.screen);
  const kb = useKb();
  const [zone, setZone] = useState<'pin' | 'search' | null>(null);
  // проверка обновлений при запуске (на Android — тот же код, что у фонового WorkManager)
  useEffect(() => { void useUpdates.getState().launch(); }, []);
  const [snap, setSnap] = useState<Snap>('half');
  const [dragH, setDragH] = useState<number | null>(null);

  // какое поле в фокусе: от этого зависит раскладка при открытой клавиатуре
  useEffect(() => {
    const f = () => {
      const a = document.activeElement as HTMLElement | null;
      setZone(a?.closest('.pinbar') ? 'pin' : a?.closest('.search') ? 'search' : null);
    };
    document.addEventListener('focusin', f); document.addEventListener('focusout', () => setTimeout(f, 0));
    return () => { document.removeEventListener('focusin', f); };
  }, []);

  const demoResults = results && results.options.length ? results : null;
  const catEnabled = !!destination && destination.kind !== 'city' && tab === 'map';
  const cat = useCatalogResult(destination, catEnabled);

  // подстраиваем высоту шторки под контекст
  useEffect(() => { if (tab !== 'map') setSnap('full'); else setSnap('half'); }, [tab]);
  useEffect(() => { if (destination) setSnap('half'); }, [destination]);
  useEffect(() => { if (selectedId) setSnap((s) => (s === 'peek' ? 'half' : s)); }, [selectedId]);

  // Кнопка «Назад» на Android: поле ввода → окна → Пин → карточка → список → точка → выход по второму нажатию
  const back = useRef(() => {});
  const lastBack = useRef(0);
  back.current = () => {
    const a = document.activeElement as HTMLElement | null;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) { a.blur(); return; }
    if (updScreen) useUpdates.getState().closeScreen();
    else if (confirmOpen) setConfirmOpen(false);
    else if (coverage) setCoverage(false);
    else if (eventDemo) setEventDemo(false);
    else if (demo) setDemo(false);
    else if (method) setMethod(false);
    else if (pinOpen) setPinOpen(false);
    else if (tab !== 'map') setTab('map');
    else if (selectedId) selectLot(null);
    else if (destination) setDestination(null);
    else if (Date.now() - lastBack.current < 2200) NativeApp.exitApp();
    else {
      lastBack.current = Date.now();
      useStore.getState().pushNotice({ kind: 'info', title: 'Нажмите «Назад» ещё раз, чтобы выйти' });
    }
  };
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const h = NativeApp.addListener('backButton', () => back.current());
    return () => { h.then((x) => x.remove()); };
  }, []);

  const H = kb.fullH;
  const pinTyping = !wide && kb.open && zone === 'pin';
  const searchTyping = !wide && kb.open && zone === 'search';
  // Пин на телефоне — отдельный экран чата: непрозрачный на всю высоту, поле ввода прижато к вкладкам или к клавиатуре.
  // Так между чатом, полем и клавиатурой не просвечивает карта.
  const pinFull = !wide && pinOpen && tab === 'map';
  const sheetH = dragH ?? snapPx(snap, H);
  const sheetTop = pinFull ? '0px' : `calc(${H - sheetH}px - var(--tab-h) - var(--safe-b))`;
  const sheetHeight: number | string = pinFull ? (pinTyping ? `${kb.h - DOCK}px` : `calc(${H - DOCK}px - var(--tab-h) - var(--safe-b))`) : sheetH;
  const showBar = tab === 'map' && !searchTyping;
  const barTop = pinFull ? (pinTyping ? `${kb.h - DOCK}px` : `calc(${H - DOCK}px - var(--tab-h) - var(--safe-b))`)
    : `calc(${H - sheetH - BAR}px - var(--tab-h) - var(--safe-b))`;
  const padBottom = sheetH + TAB + BAR;

  const onPick = useCallback((lat: number, lon: number) => {
    setDestination({ id: `pt:${lat.toFixed(4)},${lon.toFixed(4)}`, name: 'Точка на карте', address: `${lat.toFixed(4)}, ${lon.toFixed(4)}`, lat, lon, kind: 'point' });
  }, [setDestination]);

  const openPin = () => { setPinOpen(true); if (!wide) setSnap('half'); };
  const showFromPin = (r: PinReply) => {
    if (!r.show) return;
    // условия именно этого ответа (а не последнего вопроса) — чтобы карточка совпала с тем, о чём говорил Пин
    const ctx = r.ctx ?? usePin.getState().ctx;
    const st = useStore.getState();
    if (st.destination?.id !== r.show.place.id) st.setDestination(r.show.place);
    st.setPriority(ctx.priority); st.setArriveIn(ctx.arriveIn); st.setDuration(ctx.durationMin); st.setBudget(ctx.budget);
    st.selectLot(r.show.lotId);
    (document.activeElement as HTMLElement | null)?.blur?.();
    setPinOpen(false);
    setSnap('half');
  };

  const viewKey = `${tab}:${pinOpen ? 'pin' : ''}:${selectedId ?? ''}:${destination?.id ?? 'home'}`;
  let content: ReactNode;
  if (tab === 'trips') content = <Trips />;
  else if (tab === 'saved') content = <Saved />;
  else if (pinOpen) content = <Pin onClose={() => setPinOpen(false)} onShow={showFromPin} />;
  else if (isCatalogId(selectedId)) content = <CatalogDetail id={selectedId} onBack={() => selectLot(null)} />;
  else if (selected) content = <LotDetail o={selected} onBack={() => selectLot(null)} onBook={() => setConfirmOpen(true)} onMethod={() => setMethod(true)} />;
  else if (destination?.kind === 'city') content = <CityView place={destination} />;
  else if (demoResults) content = <><Results results={demoResults} /><CatalogResults place={destination!} r={cat.r} state={cat.state} compact /></>;
  else if (destination) content = <CatalogResults place={destination} r={cat.r} state={cat.state} />;
  else content = <Home onDemo={() => setDemo(true)} onCoverage={() => setCoverage(true)} onAsk={openPin} onEvent={() => setEventDemo(true)} />;

  const tabs = (
    <nav className="tabbar" aria-label="Разделы" style={wide ? undefined : { top: `calc(${H}px - var(--tab-h) - var(--safe-b))` }}>
      {([['map', 'map', 'Карта'], ['saved', 'star', 'Избранное'], ['trips', 'ticket', 'Брони']] as [Tab, string, string][]).map(([t, ic, label]) => (
        <button key={t} className={tab === t ? 'on' : ''} aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>
          <Icon name={ic} size={22} />
          <span>{label}</span>
          {t === 'trips' && activeCount > 0 && <em className="badge" aria-label={`активных броней: ${activeCount}`}>{activeCount}</em>}
        </button>
      ))}
    </nav>
  );
  const bar = showBar && <PinBar open={pinOpen} dock={pinFull} onOpen={openPin} style={wide ? {} : { top: barTop }} />;

  return (
    <div className={`app ${wide ? 'app--wide' : 'app--phone'} ${kb.open ? 'kb-open' : ''} ${pinFull ? 'app--pin' : ''}`} style={wide ? undefined : { height: H }}>
      <MapView results={tab === 'map' ? demoResults : null} cat={tab === 'map' && !demoResults ? cat.r : null} wide={wide}
        padBottom={padBottom} onPick={onPick} onSelect={(id) => { setTab('map'); setPinOpen(false); selectLot(id); }} />

      {wide ? (
        <aside className="side">
          <SearchBar onOpenDemo={() => setDemo(true)} />
          {tabs}
          <div className="side__body" key={viewKey}>{content}</div>
          {bar}
        </aside>
      ) : (
        <>
          <div className="topbar"><SearchBar onOpenDemo={() => setDemo(true)} /></div>
          <Sheet top={sheetTop} height={sheetHeight} H={H} onDrag={setDragH} onSnap={(s) => { setSnap(s); setDragH(null); }} snap={snap} viewKey={viewKey}
            dragging={dragH != null} full={pinFull}>
            {content}
          </Sheet>
          {bar}
          {tabs}
        </>
      )}

      <Toasts />
      <UpdateBanner />
      {updScreen && <UpdateScreen />}
      {demo && <DemoPanel onClose={() => setDemo(false)} selected={selected} onEvent={() => { setDemo(false); setEventDemo(true); }} />}
      {eventDemo && <EventDemo onClose={() => setEventDemo(false)} />}
      {method && <Method onClose={() => setMethod(false)} />}
      {coverage && <Coverage onClose={() => setCoverage(false)} />}
      {confirmOpen && selected && <Confirm o={selected} onClose={() => setConfirmOpen(false)} />}
    </div>
  );
}

function Sheet({ children, top, height, H, onDrag, onSnap, snap, viewKey, dragging, full }: {
  children: ReactNode; top: string; height: number | string; H: number; snap: Snap; viewKey: string; dragging: boolean; full: boolean;
  onDrag: (h: number | null) => void; onSnap: (s: Snap) => void;
}) {
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { body.current?.scrollTo({ top: 0 }); }, [viewKey]);
  const start = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const down = (e: React.PointerEvent) => {
    if (typeof height !== 'number') return;
    start.current = { y: e.clientY, h: height, moved: false };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    if (!start.current) return;
    const dy = e.clientY - start.current.y;
    if (Math.abs(dy) > 4) start.current.moved = true;
    if (start.current.moved) onDrag(Math.max(120, Math.min(snapPx('full', H), start.current.h - dy)));
  };
  const up = (e: React.PointerEvent) => {
    if (!start.current) return;
    const { moved, y, h } = start.current;
    start.current = null;
    if (!moved) { onSnap(snap === 'full' ? 'half' : 'full'); return; }
    const cur = h - (e.clientY - y);
    const opts: Snap[] = ['peek', 'half', 'full'];
    onSnap(opts.reduce((a, b) => (Math.abs(snapPx(b, H) - cur) < Math.abs(snapPx(a, H) - cur) ? b : a)));
  };
  return (
    <section className={`sheet ${dragging ? 'sheet--drag' : ''} ${full ? 'sheet--full' : ''}`} style={{ top, height }} aria-label={full ? 'Пин' : 'Парковки'}>
      {!full && <div className="sheet__grip" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        role="button" tabIndex={0} aria-label={snap === 'full' ? 'Свернуть панель' : 'Развернуть панель'}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSnap(snap === 'full' ? 'half' : 'full'); }}>
        <span />
      </div>}
      <div className="sheet__body" ref={body} key={viewKey}>{children}</div>
    </section>
  );
}
