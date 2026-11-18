import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { RELEASE, validateManifest, type ReleaseManifest } from './manifest';

export type CheckStatus = 'update' | 'current' | 'offline' | 'error' | 'not-configured';
export type NotifyResult = 'shown' | 'already' | 'disabled' | 'current' | 'update';

export interface CheckResponse { status: CheckStatus; result?: NotifyResult; manifest?: ReleaseManifest; installedCode: number; error?: string }
export interface Info {
  platform: 'android' | 'web'; versionCode: number; versionName: string; debug: boolean; manifestUrl: string;
  notificationsEnabled: boolean; notifiedCode?: number; lastCheck?: number; lastResult?: string; lastSource?: string;
}

interface Plugin {
  getInfo(): Promise<Info>;
  configure(o: { manifestUrl: string }): Promise<void>;
  check(o: { notify: boolean }): Promise<CheckResponse>;
  resetNotified(): Promise<void>;
  runWorkerNow(): Promise<void>;
  takePending(): Promise<{ pendingCode: number; openedFromNotification: boolean }>;
  requestNotifications(): Promise<{ notificationsEnabled: boolean }>;
  openNotificationSettings(): Promise<void>;
  download(o: { apkUrl: string; sha256?: string | null; manifestUrl: string; versionName: string }): Promise<{ status: 'installer' | 'needs-permission'; sha256: string; bytes: number }>;
  addListener(e: 'openUpdate', f: (d: { versionCode: number }) => void): Promise<PluginListenerHandle>;
  addListener(e: 'downloadProgress', f: (d: { done: number; total: number }) => void): Promise<PluginListenerHandle>;
}

/** Веб-версия (PWA и тесты): проверка через fetch, уведомления — только внутри приложения. */
let webUrl = RELEASE.manifestUrl;
const web: Plugin = {
  async getInfo() {
    return { platform: 'web', versionCode: RELEASE.versionCode, versionName: RELEASE.versionName, debug: !!import.meta.env?.DEV, manifestUrl: webUrl,
      notificationsEnabled: typeof Notification !== 'undefined' && Notification.permission === 'granted' };
  },
  async configure({ manifestUrl }) { webUrl = manifestUrl; },
  async check() {
    const installedCode = RELEASE.versionCode;
    if (!webUrl) return { status: 'not-configured', installedCode };
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch(webUrl, { cache: 'no-store', signal: ctl.signal });
      if (!r.ok) return { status: 'error', installedCode, error: `Сервер обновлений ответил ${r.status}` };
      const m = validateManifest(await r.json(), webUrl, !!import.meta.env?.DEV);
      return { status: m.versionCode > installedCode ? 'update' : 'current', result: m.versionCode > installedCode ? 'disabled' : 'current', manifest: m, installedCode };
    } catch (e) {
      const msg = (e as Error).message;
      return e instanceof TypeError || (e as Error).name === 'AbortError'
        ? { status: 'offline', installedCode, error: msg } : { status: 'error', installedCode, error: msg };
    } finally { clearTimeout(t); }
  },
  async resetNotified() {},
  async runWorkerNow() {},
  async takePending() { return { pendingCode: 0, openedFromNotification: false }; },
  async requestNotifications() {
    if (typeof Notification === 'undefined') return { notificationsEnabled: false };
    return { notificationsEnabled: (await Notification.requestPermission()) === 'granted' };
  },
  async openNotificationSettings() {},
  async download({ apkUrl }) { window.open(apkUrl, '_blank', 'noopener'); return { status: 'installer', sha256: '', bytes: 0 }; },
  async addListener() { return { remove: async () => {} }; },
};

export const isNative = Capacitor.isNativePlatform();
export const Updates: Plugin = isNative ? registerPlugin<Plugin>('ParklyUpdates') : web;
