// «Где моя машина»: одна запись на телефоне (localStorage), переживает перезапуск, удаляется пользователем.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { distM } from '../catalog/data';

/** Насколько можно сдвинуть точку на карте, чтобы она осталась «той же парковкой». */
export const SAME_LOT_M = 150;

export interface CarSpot {
  lat: number;
  lon: number;
  /** Откуда точка: парковка из приложения, GPS телефона или отмечена на карте вручную. */
  how: 'lot' | 'gps' | 'map';
  /** Где именно: «−2 этаж, ряд B». */
  note: string;
  /** Название парковки, если сохраняли из её карточки. */
  lotName?: string;
  lotId?: string;
  acc?: number;
  savedAt: number;
}

interface CarState {
  car: CarSpot | null;
  /** Режим «отметить на карте»: следующее касание карты ставит точку машины. */
  picking: boolean;
  /** Заметка, набранная до того, как точку отметили на карте. */
  pendingNote: string;
  /** Касание карты в режиме «отметить»: точка — сюда, заметка — прежняя или набранная. */
  pick: (lat: number, lon: number) => void;
  save: (c: Omit<CarSpot, 'savedAt'>) => void;
  setNote: (note: string) => void;
  remove: () => void;
  setPicking: (v: boolean) => void;
}

export const useCar = create<CarState>()(
  persist(
    (set, get) => ({
      car: null,
      picking: false,
      pendingNote: '',
      pick: (lat, lon) => {
        const c = get().car;
        // Поправка в пределах той же парковки сохраняет её название; точка в другом месте — уже не та парковка.
        const sameLot = c?.lotId && distM(c.lat, c.lon, lat, lon) <= SAME_LOT_M;
        set({ car: { lat, lon, how: 'map', note: c?.note || get().pendingNote, ...(sameLot ? { lotName: c!.lotName, lotId: c!.lotId } : {}), savedAt: Date.now() }, picking: false, pendingNote: '' });
      },
      save: (c) => set({ car: { ...c, note: c.note.trim().slice(0, 80), savedAt: Date.now() }, picking: false }),
      setNote: (note) => { const c = get().car; if (c) set({ car: { ...c, note: note.trim().slice(0, 80) } }); },
      remove: () => set({ car: null }),
      setPicking: (picking) => set(picking ? { picking } : { picking, pendingNote: '' }),
    }),
    { name: 'parkly-car', storage: createJSONStorage(() => localStorage), partialize: (s) => ({ car: s.car }) },
  ),
);
