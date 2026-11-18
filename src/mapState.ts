// Состояние карты, которое нужно вне MapView: текущий вид, запросы «перелететь сюда», геолокация, клавиатура.
import { create } from 'zustand';

export interface View { lat: number; lon: number; zoom: number; s: number; w: number; n: number; e: number }
export interface FlyReq { id: number; lat: number; lon: number; zoom?: number }
export type GeoStatus = 'idle' | 'asking' | 'ok' | 'denied' | 'unavailable' | 'timeout';

interface MapState {
  view: View | null;
  fly: FlyReq | null;
  geo: { status: GeoStatus; lat?: number; lon?: number; acc?: number };
  online: boolean;
  setView: (v: View) => void;
  flyTo: (lat: number, lon: number, zoom?: number) => void;
  locate: () => Promise<void>;
  setOnline: (v: boolean) => void;
}

let seq = 0;
export const useMap = create<MapState>()((set, get) => ({
  view: null,
  fly: null,
  geo: { status: 'idle' },
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  setView: (view) => set({ view }),
  flyTo: (lat, lon, zoom) => set({ fly: { id: ++seq, lat, lon, zoom } }),
  setOnline: (online) => set({ online }),
  async locate() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { set({ geo: { status: 'unavailable' } }); return; }
    set({ geo: { ...get().geo, status: 'asking' } });
    await new Promise<void>((done) => {
      navigator.geolocation.getCurrentPosition(
        (p) => {
          set({ geo: { status: 'ok', lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy } });
          get().flyTo(p.coords.latitude, p.coords.longitude, 16);
          done();
        },
        (e) => { set({ geo: { status: e.code === e.PERMISSION_DENIED ? 'denied' : e.code === e.TIMEOUT ? 'timeout' : 'unavailable' } }); done(); },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
      );
    });
  },
}));

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => useMap.getState().setOnline(true));
  window.addEventListener('offline', () => useMap.getState().setOnline(false));
}

/**
 * Клавиатура на Android сжимает окно WebView. Запоминаем полную высоту экрана,
 * чтобы раскладка не прыгала, а «клавиатура открыта» считаем по разнице.
 */
export function useViewport() {
  return useKb((s) => s);
}
interface Kb { fullH: number; h: number; open: boolean }
export const useKb = create<Kb>()(() => ({ fullH: typeof window === 'undefined' ? 800 : window.innerHeight, h: typeof window === 'undefined' ? 800 : window.innerHeight, open: false }));
if (typeof window !== 'undefined') {
  let lastW = window.innerWidth;
  const upd = () => {
    const h = window.innerHeight, w = window.innerWidth;
    const st = useKb.getState();
    // поворот или другое окно — новая «полная» высота
    const fullH = w !== lastW ? h : Math.max(st.fullH, h);
    lastW = w;
    const shrunk = fullH - h > 140;
    // клавиатуру закрыли кнопкой «Назад» — снимаем фокус, чтобы следующее «Назад» не уходило впустую
    if (st.open && !shrunk && document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
    const open = shrunk && document.activeElement instanceof HTMLInputElement;
    if (fullH !== st.fullH || h !== st.h || open !== st.open) useKb.setState({ fullH, h, open });
  };
  window.addEventListener('resize', upd);
  document.addEventListener('focusin', () => setTimeout(upd, 60));
  document.addEventListener('focusout', () => setTimeout(upd, 60));
}
