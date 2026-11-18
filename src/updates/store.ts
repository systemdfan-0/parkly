import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Updates, isNative, type CheckResponse, type Info } from './native';
import { RELEASE, manifestUrlFor, type Channel, type ReleaseManifest } from './manifest';

interface UpdState {
  channel: Channel;
  /** Версия, о которой пользователь уже узнал внутри приложения (чтобы баннер не повторялся). */
  seenInAppCode: number;
  info: Info | null;
  last: CheckResponse | null;
  checking: boolean;
  screen: boolean;
  banner: ReleaseManifest | null;
  setChannel: (c: Channel) => Promise<void>;
  check: (opts: { manual: boolean }) => Promise<CheckResponse>;
  launch: () => Promise<void>;
  openScreen: () => void;
  closeScreen: () => void;
  dismissBanner: () => void;
  refreshInfo: () => Promise<void>;
}

const defaultChannel = (): Channel => 'release';

export const useUpdates = create<UpdState>()(persist((set, get) => ({
  channel: defaultChannel(),
  seenInAppCode: 0,
  info: null,
  last: null,
  checking: false,
  screen: false,
  banner: null,

  async setChannel(channel) {
    set({ channel, last: null });
    await Updates.configure({ manifestUrl: manifestUrlFor(channel, isNative) });
  },
  async refreshInfo() { set({ info: await Updates.getInfo() }); },

  /** Одна проверка: при запуске (manual=false) или по кнопке «Проверить обновления». */
  async check({ manual }) {
    set({ checking: true });
    try {
      await Updates.configure({ manifestUrl: manifestUrlFor(get().channel, isNative) });
      const r = await Updates.check({ notify: true });
      const info = await Updates.getInfo();
      set({ last: r, info });
      // системные уведомления выключены (или это веб) — показываем обновление внутри приложения
      if (r.status === 'update' && r.manifest && !manual && (r.result === 'disabled' || !isNative) && get().seenInAppCode < r.manifest.versionCode) {
        set({ banner: r.manifest });
      }
      return r;
    } finally { set({ checking: false }); }
  },

  async launch() {
    const info = await Updates.getInfo();
    set({ info });
    const pending = await Updates.takePending();
    const r = await get().check({ manual: false });
    if (pending.openedFromNotification && r.manifest) set({ screen: true });
    // воркер нашёл версию, пока уведомления были выключены, — показать при этом запуске
    else if (pending.pendingCode && r.manifest && r.status === 'update' && get().seenInAppCode < r.manifest.versionCode) set({ banner: r.manifest });
    Updates.addListener('openUpdate', () => { set({ screen: true }); void get().check({ manual: true }); });
  },

  openScreen() {
    const m = get().banner ?? get().last?.manifest;
    set({ screen: true, banner: null, seenInAppCode: Math.max(get().seenInAppCode, m?.versionCode ?? 0) });
  },
  closeScreen() { set({ screen: false }); },
  dismissBanner() { const m = get().banner; set({ banner: null, seenInAppCode: Math.max(get().seenInAppCode, m?.versionCode ?? 0) }); },
}), {
  name: 'parkly-updates',
  storage: createJSONStorage(() => localStorage),
  partialize: (s) => ({ channel: s.channel, seenInAppCode: s.seenInAppCode }),
}));
