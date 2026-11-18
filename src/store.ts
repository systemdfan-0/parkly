import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { DESTINATIONS, LOTS, LOT_BY_ID, ORIGINS, destToPlace, type Place } from './data/places';
import { freeNow, stepOcc, reservedAt, isOpenAt, type Booking, type Rng } from './engine/model';
import { priceFor } from './engine/pricing';
import type { Priority } from './engine/recommend';
import { DEFAULT_SCENARIO, DEMO_SEED, SCENARIOS, initialOccupancy, initialHistory, scenarioStart, seededHistory } from './engine/scenarios';
import { MIN, fmtTime } from './engine/time';

export type Tab = 'map' | 'saved' | 'trips';

export interface Notice {
  id: string;
  kind: 'spot' | 'info' | 'success' | 'check';
  title: string;
  text?: string;
  lotId?: string;
  at: number;
}

export interface SimState {
  now: number;
  speed: number; // 0 — пауза
  rng: Rng;
  occ: Record<string, number>;
  /** Занятость по минутам за последние 15 минут (16 значений, последнее — текущая минута): вход ML-модели. */
  hist: Record<string, number[]>;
  histMin: number;
  scenarioId: string;
}

interface State {
  sim: SimState;
  bookings: Booking[];
  favorites: string[];
  watches: string[];
  notices: Notice[];
  lastAlert: Record<string, number>;
  destination: Place | null;
  origin: Place;
  durationMin: number;
  priority: Priority;
  /** «Приеду через N минут» (Пин и переключатель в списке); null — по времени в пути. */
  arriveIn: number | null;
  /** Бюджет, ₸ в час (из запроса Пину). null — без ограничения. */
  budget: number | null;
  selectedLotId: string | null;
  /** Парковка, которую сейчас советует Пин (подсветка на карте). */
  pinLotId: string | null;
  tab: Tab;
  recent: Place[];
  onboarded: boolean;

  tick: (dtMin: number) => void;
  jump: (min: number) => void;
  setSpeed: (s: number) => void;
  setScenario: (id: string) => void;
  resetDemo: () => void;
  demoRelease: (lotId: string, n?: number) => void;
  demoFill: (lotId: string) => void;

  setDestination: (p: Place | null) => void;
  setOrigin: (p: Place) => void;
  selectLot: (id: string | null) => void;
  setDuration: (m: number) => void;
  setPriority: (p: Priority) => void;
  setArriveIn: (m: number | null) => void;
  setBudget: (b: number | null) => void;
  setPinLot: (id: string | null) => void;
  pinDemo: () => void;
  setTab: (t: Tab) => void;
  toggleFavorite: (id: string) => void;
  toggleWatch: (id: string) => void;
  book: (args: { lotId: string; destName: string; arriveAt: number; durationMin: number }) => Booking | string;
  cancelBooking: (id: string) => void;
  finishBooking: (id: string) => void;
  pushNotice: (n: Omit<Notice, 'id' | 'at'>) => void;
  dismissNotice: (id: string) => void;
  setOnboarded: () => void;
}

const uid = () => Math.random().toString(36).slice(2, 10);
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

const watchedFree = (s: State) =>
  Object.fromEntries(s.watches.map((id) => [id, freeNow(LOT_BY_ID[id], s.sim.occ[id] ?? 0, s.sim.now, s.bookings)]));

function freshSim(scenarioId: string): SimState {
  const sc = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];
  const now = scenarioStart(sc);
  return { now, speed: 1, rng: { s: DEMO_SEED }, occ: initialOccupancy(now), hist: initialHistory(now), histMin: Math.floor(now / MIN), scenarioId: sc.id };
}

/** Продвигает симуляцию, завершает брони и ловит «освободилось место» на отслеживаемых парковках. */
function advance(s: State, dtMin: number): Partial<State> {
  const sim = { ...s.sim, occ: { ...s.sim.occ }, rng: { ...s.sim.rng }, hist: { ...s.sim.hist } };
  const watchedBefore = watchedFree(s);
  let left = dtMin;
  while (left > 1e-9) {
    const dt = Math.min(1, left);
    for (const lot of LOTS) {
      const reserved = reservedAt(lot.id, sim.now, s.bookings);
      sim.occ[lot.id] = stepOcc(lot, sim.occ[lot.id] ?? 0, reserved, sim.now, dt, sim.rng);
    }
    sim.now += dt * MIN;
    left -= dt;
    // замер раз в минуту — как датчик на въезде
    while (sim.histMin < Math.floor(sim.now / MIN)) {
      sim.histMin++;
      for (const lot of LOTS) sim.hist[lot.id] = [...(sim.hist[lot.id] ?? []), sim.occ[lot.id] ?? 0].slice(-16);
    }
  }
  const bookings = s.bookings.map((b) => (b.status === 'active' && b.endAt <= sim.now ? { ...b, status: 'completed' as const, closedAt: b.endAt } : b));
  return { sim, bookings, ...spotAlerts(s, watchedBefore, sim, bookings, 2) };
}

/** Уведомление: на отслеживаемой парковке было 0 мест, стало ≥ 1 (не чаще раза в minGap минут). */
function spotAlerts(s: State, before: Record<string, number>, sim: SimState, bookings: Booking[], minGap: number) {
  const notices = [...s.notices];
  const lastAlert = { ...s.lastAlert };
  let changed = false;
  for (const id of s.watches) {
    const lot = LOT_BY_ID[id];
    const after = freeNow(lot, sim.occ[id] ?? 0, sim.now, bookings);
    if (before[id] === 0 && after >= 1 && sim.now - (lastAlert[id] ?? -Infinity) >= minGap * MIN) {
      lastAlert[id] = sim.now;
      changed = true;
      notices.push({ id: uid(), kind: 'spot', lotId: id, at: sim.now,
        title: `Освободилось место: ${lot.short}`,
        text: `${after === 1 ? 'Одно место' : `Мест: ${after}`} в ${fmtTime(sim.now)}. Забронируйте, пока не заняли.` });
      notifySystem('Parkly: освободилось место', `${lot.name}: свободно ${after}`);
    }
  }
  return changed ? { notices: notices.slice(-6), lastAlert } : {};
}

function notifySystem(title: string, body: string) {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.([120, 60, 120]);
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
      new Notification(title, { body, icon: './icon-192.png' });
    }
  } catch { /* необязательно */ }
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      sim: freshSim(DEFAULT_SCENARIO),
      bookings: seededHistory(freshSim(DEFAULT_SCENARIO).now),
      favorites: ['dp-office'],
      watches: [],
      notices: [],
      lastAlert: {},
      destination: null,
      origin: ORIGINS[0],
      durationMin: 120,
      priority: 'balanced',
      arriveIn: null,
      budget: null,
      selectedLotId: null,
      pinLotId: null,
      tab: 'map',
      recent: [],
      onboarded: false,

      tick: (dt) => set((s) => (s.sim.speed ? advance(s, dt) : {})),
      jump: (min) => set((s) => advance(s, min)),
      setSpeed: (speed) => set((s) => ({ sim: { ...s.sim, speed } })),
      setScenario: (id) => set((s) => {
        const sim = freshSim(id);
        // активные брони из другого времени закрываем, чтобы не ломать учёт мест
        const bookings = s.bookings.map((b) => (b.status === 'active' ? { ...b, status: 'cancelled' as const, closedAt: s.sim.now } : b));
        return { sim, bookings, lastAlert: {}, notices: [] };
      }),
      resetDemo: () => {
        const sim = freshSim(DEFAULT_SCENARIO);
        set({ sim, bookings: seededHistory(sim.now), favorites: ['dp-office'], watches: [], notices: [], lastAlert: {},
          destination: null, selectedLotId: null, durationMin: 120, priority: 'balanced', arriveIn: null, budget: null, origin: ORIGINS[0], tab: 'map', recent: [] });
      },
      demoRelease: (lotId, n = 1) => set((s) => {
        const sim = { ...s.sim, occ: { ...s.sim.occ, [lotId]: Math.max(0, (s.sim.occ[lotId] ?? 0) - n) } };
        return { sim, ...spotAlerts(s, watchedFree(s), sim, s.bookings, 0) };
      }),
      demoFill: (lotId) => set((s) => {
        const lot = LOT_BY_ID[lotId];
        const reserved = reservedAt(lotId, s.sim.now, s.bookings);
        return { sim: { ...s.sim, occ: { ...s.sim.occ, [lotId]: Math.max(0, lot.capacity - reserved) } } };
      }),

      setDestination: (p) => set((s) => ({
        destination: p, selectedLotId: null, pinLotId: null, tab: 'map',
        recent: p && p.kind !== 'point' ? [p, ...s.recent.filter((r) => r.id !== p.id)].slice(0, 5) : s.recent,
      })),
      setOrigin: (origin) => set({ origin }),
      selectLot: (id) => set({ selectedLotId: id }),
      setDuration: (durationMin) => set({ durationMin }),
      setPriority: (priority) => set({ priority }),
      setArriveIn: (arriveIn) => set({ arriveIn }),
      setBudget: (budget) => set({ budget }),
      setPinLot: (pinLotId) => set({ pinLotId }),
      // Сценарий защиты для Пина: театр Абая, будни 18:25, время на паузе — результат воспроизводим
      pinDemo: () => set((s) => {
        const sim = { ...freshSim('evening'), speed: 0 };
        const bookings = s.bookings.map((b) => (b.status === 'active' ? { ...b, status: 'cancelled' as const, closedAt: s.sim.now } : b));
        const d = DESTINATIONS.find((x) => x.id === 'opera')!;
        return { sim, bookings, notices: [], lastAlert: {}, destination: destToPlace(d), selectedLotId: null, priority: 'balanced', arriveIn: 5, budget: null,
          durationMin: 120, origin: ORIGINS[0], tab: 'map' };
      }),
      setTab: (tab) => set({ tab }),
      toggleFavorite: (id) => set((s) => ({ favorites: s.favorites.includes(id) ? s.favorites.filter((x) => x !== id) : [...s.favorites, id] })),
      toggleWatch: (id) => set((s) => ({ watches: s.watches.includes(id) ? s.watches.filter((x) => x !== id) : [...s.watches, id] })),

      book: ({ lotId, destName, arriveAt, durationMin }) => {
        const s = get();
        const lot = LOT_BY_ID[lotId];
        if (!lot.bookable) return 'На этой парковке нет брони — оплата на месте.';
        if (!isOpenAt(lot, s.sim.now) || !isOpenAt(lot, arriveAt)) return 'Парковка закрыта.';
        if (freeNow(lot, s.sim.occ[lotId] ?? 0, s.sim.now, s.bookings) < 1) return 'Свободных мест не осталось — включите уведомление.';
        if (s.bookings.some((b) => b.lotId === lotId && b.status === 'active')) return 'У вас уже есть бронь на этой парковке.';
        const price = priceFor(lot, arriveAt, durationMin).total;
        const b: Booking = { id: uid(), code: code(), lotId, destName, createdAt: s.sim.now, arriveAt, endAt: arriveAt + durationMin * MIN,
          durationMin, price, status: 'active' };
        set({ bookings: [b, ...s.bookings], watches: s.watches.filter((w) => w !== lotId) });
        return b;
      },
      cancelBooking: (id) => set((s) => ({
        bookings: s.bookings.map((b) => (b.id === id && b.status === 'active' ? { ...b, status: 'cancelled', closedAt: s.sim.now, price: 0 } : b)),
      })),
      finishBooking: (id) => set((s) => ({
        bookings: s.bookings.map((b) => {
          if (b.id !== id || b.status !== 'active') return b;
          const used = Math.max(1, Math.round((s.sim.now - b.arriveAt) / MIN));
          return { ...b, status: 'completed', closedAt: s.sim.now, endAt: s.sim.now, durationMin: used, price: priceFor(LOT_BY_ID[b.lotId], b.arriveAt, used).total };
        }),
      })),
      pushNotice: (n) => set((s) => ({ notices: [...s.notices, { ...n, id: uid(), at: s.sim.now }].slice(-6) })),
      dismissNotice: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
      setOnboarded: () => set({ onboarded: true }),
    }),
    {
      name: 'parkly-v1',
      version: 2,
      storage: createJSONStorage(() => localStorage),
      // v1 → v2: появилась история замеров для ML-модели
      migrate: (old, v) => {
        const st = old as { sim?: SimState };
        if (v < 2 && st.sim && !st.sim.hist) {
          st.sim.hist = Object.fromEntries(Object.entries(st.sim.occ).map(([id, o]) => [id, Array(16).fill(o)]));
          st.sim.histMin = Math.floor(st.sim.now / MIN);
        }
        return st as unknown as State;
      },
      partialize: (s) => ({
        sim: s.sim, bookings: s.bookings, favorites: s.favorites, watches: s.watches, lastAlert: s.lastAlert,
        destination: s.destination, origin: s.origin, durationMin: s.durationMin, priority: s.priority, arriveIn: s.arriveIn, budget: s.budget,
        selectedLotId: s.selectedLotId, tab: s.tab, recent: s.recent, onboarded: s.onboarded,
      }),
    },
  ),
);

export const selectFree = (s: State, lotId: string) => freeNow(LOT_BY_ID[lotId], s.sim.occ[lotId] ?? 0, s.sim.now, s.bookings);
