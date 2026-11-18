// Разговор с Пином: сообщения и контекст последнего запроса (для «а поближе?», «тогда до 700»).
import { create } from 'zustand';
import { loadIndex, loadPois } from './catalog/data';
import { cityPlace, type GeoHit } from './catalog/geo';
import { understand, extractSlots, EMPTY_CTX, cityIn, type PinCtx } from './engine/pinText';
import { talk, dunno, type Talk } from './engine/pinTalk';
import { distM, type CatalogIndex } from './catalog/data';
import { LOT_BY_ID, type Place } from './data/places';
import { pinReply, type PinAction, type PinReply } from './engine/pinReply';
import { useStore } from './store';
import { useMap } from './mapState';

export interface Msg {
  id: number;
  from: 'me' | 'pin';
  text: string;
  reply?: PinReply;
  options?: GeoHit[];
  /** Подсказки-фразы: нажатие отправляет их Пину. */
  suggest?: string[];
}

interface PinState {
  msgs: Msg[];
  ctx: PinCtx;
  lastLot: string | null;
  busy: boolean;
  send: (text: string) => Promise<void>;
  act: (a: PinAction) => Promise<void>;
  choose: (h: GeoHit) => Promise<void>;
  reset: () => void;
}

let seq = 0;
const simInput = () => {
  const s = useStore.getState();
  return { now: s.sim.now, origin: s.origin, occ: s.sim.occ, bookings: s.bookings, hist: s.sim.hist };
};

export const usePin = create<PinState>()((set, get) => {
  const say = (m: Omit<Msg, 'id'>) => set((s) => ({ msgs: [...s.msgs, { ...m, id: ++seq }].slice(-30) }));

  async function answer(ctx: PinCtx, changed: string[]) {
    const reply = await pinReply(ctx, simInput(), get().lastLot, changed);
    set({ ctx, lastLot: reply.lotId ?? get().lastLot });
    say({ from: 'pin', text: reply.text, reply });
    // подсветка совета на карте (кнопка «Показать на карте» откроет парковку)
    if (reply.show && reply.mode === 'demo') useStore.getState().setPinLot(reply.show.lotId);
  }

  function sayTalk(tk: Extract<Talk, { kind: 'say' }>) {
    const ctx = get().ctx;
    const show = tk.showLot && ctx.place ? { lotId: tk.showLot, place: ctx.place } : undefined;
    const reply: PinReply | undefined = show ? { text: tk.text, mode: LOT_BY_ID[tk.showLot!] ? 'demo' : 'catalog', show } : undefined;
    say({ from: 'pin', text: tk.text, reply, suggest: tk.suggest });
  }

  /** «Рядом со мной»: геопозиция, а если её нет — центр карты. */
  async function nearMe(ix: CatalogIndex, base: PinCtx) {
    const mp = useMap.getState();
    if (mp.geo.status !== 'ok') await mp.locate();
    const g = useMap.getState().geo;
    let p: Place;
    if (g.status === 'ok' && g.lat != null) {
      p = { id: `me:${g.lat.toFixed(4)},${g.lon!.toFixed(4)}`, name: 'Ваше местоположение', address: '', lat: g.lat, lon: g.lon!, kind: 'point' };
    } else {
      const v = useMap.getState().view;
      if (!v || v.zoom < 11) {
        say({ from: 'pin', text: g.status === 'denied' ? 'Нет доступа к геолокации, поэтому не знаю, где вы. Разрешите его в настройках телефона или напишите, куда едете.' : 'Не смог определить, где вы: геолокация выключена или не ответила. Напишите место или приблизьте карту к нужному району и спросите снова.', suggest: ['Хан Шатыр', 'Dostyk Plaza'] });
        return;
      }
      say({ from: 'pin', text: 'Геолокация недоступна — ищу у центра карты.' });
      p = { id: `view:${v.lat.toFixed(4)},${v.lon.toFixed(4)}`, name: 'Центр карты', address: '', lat: v.lat, lon: v.lon, kind: 'point' };
    }
    const city = ix.cities.filter((c) => c.lots > 0).map((c) => ({ c, d: distM(p.lat, p.lon, c.lat, c.lon) })).sort((a, b) => a.d - b.d)[0];
    set({ lastLot: null });
    await answer({ ...base, place: p, city: city && city.d < 30_000 ? city.c : null, priority: 'close' }, ['place']);
  }

  return {
    msgs: [],
    ctx: EMPTY_CTX(),
    lastLot: null,
    busy: false,

    async send(text) {
      const t = text.trim();
      if (!t || get().busy) return;
      say({ from: 'me', text: t });
      set({ busy: true });
      try {
        const [ix, pois] = await Promise.all([loadIndex(), loadPois()]);
        const v = useMap.getState().view;
        const st = useStore.getState();
        // первый вопрос без контекста: учитываем приоритет и длительность из приложения
        const prev = get().ctx.place || get().ctx.city ? get().ctx : EMPTY_CTX({ priority: st.priority, durationMin: st.durationMin });
        const first = talk({ text: t, ctx: get().ctx, lastLot: get().lastLot, ix, sim: simInput() }, true);
        if (first?.kind === 'say') { sayTalk(first); return; }
        const u = understand(t, prev, ix, pois, v ? { lat: v.lat, lon: v.lon } : null);
        const placeFound = (u.kind === 'query' && u.changed.includes('place')) || u.kind === 'ask-place' || u.kind === 'ask-city';
        if (!placeFound) {
          // не подбор нового места: вопрос про прошлую парковку, про приложение, разговор или «рядом со мной»
          const tk = talk({ text: t, ctx: get().ctx, lastLot: get().lastLot, ix, sim: simInput() });
          if (tk?.kind === 'near' || (!tk && u.kind === 'need-place' && extractSlots(t).priority === 'close')) { await nearMe(ix, u.ctx); return; }
          if (tk) { sayTalk(tk); return; }
        }
        if (u.kind === 'query') {
          if (u.ctx.place?.id !== get().ctx.place?.id) set({ lastLot: null });
          await answer(u.ctx, u.changed);
        } else if (u.kind === 'ask-place') {
          set({ ctx: u.ctx });
          say({ from: 'pin', text: u.question, options: u.options });
        } else if (u.kind === 'ask-city') {
          set({ ctx: u.ctx });
          if (u.ctx.city) useMap.getState().flyTo(u.ctx.city.lat, u.ctx.city.lon, 12);
          say({ from: 'pin', text: u.question });
        } else if (u.kind === 'not-found') {
          const d = dunno(u.text, !!prev.city) as Extract<Talk, { kind: 'say' }>;
          say({ from: 'pin', text: d.text, suggest: d.suggest });
        } else {
          say({ from: 'pin', text: 'Куда едем? Напишите место, например «Dostyk Plaza» или «Хан Шатыр», или «рядом со мной».', suggest: ['Рядом со мной', 'Что ты умеешь?'] });
        }
      } catch {
        say({ from: 'pin', text: 'Не смог открыть каталог парковок. Перезапустите приложение — данные лежат на телефоне.' });
      } finally {
        set({ busy: false });
      }
    },

    async act(a) {
      if (get().busy) return;
      set({ busy: true });
      try {
        if (a.place) {
          say({ from: 'me', text: a.label });
          set({ lastLot: null });
          await answer({ ...get().ctx, place: a.place, city: a.city ?? get().ctx.city }, ['place']);
        } else if (a.patch) {
          say({ from: 'me', text: a.label });
          await answer({ ...get().ctx, ...a.patch }, Object.keys(a.patch));
        }
      } finally { set({ busy: false }); }
    },

    async choose(h) {
      if (get().busy) return;
      set({ busy: true });
      try {
        say({ from: 'me', text: h.city && h.kind !== 'city' ? `${h.place.name}, ${h.city.ru}` : h.place.name });
        if (h.kind === 'city' && h.city) {
          set({ ctx: { ...get().ctx, city: h.city, place: null } });
          useMap.getState().flyTo(h.city.lat, h.city.lon, 12);
          say({ from: 'pin', text: `Куда именно в ${cityIn(h.city.ru)}? Напишите место или адрес.` });
          return;
        }
        set({ lastLot: null });
        await answer({ ...get().ctx, place: h.place, city: h.city ?? get().ctx.city }, ['place']);
      } finally { set({ busy: false }); }
    },

    reset: () => { set({ msgs: [], ctx: EMPTY_CTX(), lastLot: null }); useStore.getState().setPinLot(null); },
  };
});

export { cityPlace };
