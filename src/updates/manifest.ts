import release from '../../release.config.json';

/** Манифест релиза: лежит по HTTPS-адресу из release.config.json (manifestUrl). */
export interface ReleaseManifest {
  versionCode: number;
  versionName: string;
  changes: string[];
  apkUrl: string;
  sha256?: string | null;
  size?: number;
  publishedAt?: string | null;
  manifestUrl: string;
}

export const RELEASE = release as {
  versionCode: number; versionName: string; manifestUrl: string; trustedHosts: string[]; checkEveryHours: number; testServerPort: number;
};

export type Channel = 'release' | 'test-current' | 'test-new' | 'test-offline';
export const CHANNEL_LABEL: Record<Channel, string> = {
  release: 'Релиз', 'test-current': 'Тест: та же версия', 'test-new': 'Тест: новая версия', 'test-offline': 'Тест: сервер недоступен',
};

/** Тестовые манифесты отдаёт scripts/release-test-server.mjs; из эмулятора компьютер виден как 10.0.2.2. */
export function manifestUrlFor(channel: Channel, native: boolean): string {
  const base = `http://${native ? '10.0.2.2' : 'localhost'}:${RELEASE.testServerPort}`;
  switch (channel) {
    case 'release': return RELEASE.manifestUrl;
    case 'test-current': return `${base}/manifest-current.json`;
    case 'test-new': return `${base}/manifest-new.json`;
    case 'test-offline': return 'https://updates.parkly.invalid/manifest.json';
  }
}

function isTestHost(u: URL) {
  return u.protocol === 'http:' && ['10.0.2.2', 'localhost', '127.0.0.1'].includes(u.hostname) && Number(u.port) === RELEASE.testServerPort;
}

/** Те же правила, что в UpdateCore.java: HTTPS и доверенный хост; тестовый сервер — только в отладке. */
export function isAllowedUrl(url: string, manifestHost: string | null, allowTest: boolean): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (allowTest && isTestHost(u)) return true;
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (manifestHost && host === manifestHost.toLowerCase()) return true;
  return RELEASE.trustedHosts.some((t) => host === t || host.endsWith('.' + t));
}

export function validateManifest(data: unknown, manifestUrl: string, allowTest: boolean): ReleaseManifest {
  const o = data as Record<string, unknown>;
  if (!o || typeof o !== 'object') throw new Error('Манифест не JSON-объект');
  const versionCode = Number(o.versionCode);
  if (!Number.isInteger(versionCode) || versionCode <= 0) throw new Error('Неверный versionCode');
  if (typeof o.versionName !== 'string' || !o.versionName) throw new Error('Нет versionName');
  if (!Array.isArray(o.changes) || !o.changes.length || !o.changes.every((c) => typeof c === 'string')) throw new Error('В манифесте нет списка изменений');
  if (typeof o.apkUrl !== 'string') throw new Error('Нет ссылки на APK');
  const sha = o.sha256 == null ? null : String(o.sha256);
  if (sha && !/^[0-9a-f]{64}$/i.test(sha)) throw new Error('Неверная контрольная сумма sha256');
  const mHost = (() => { try { return new URL(manifestUrl).hostname; } catch { return null; } })();
  if (!isAllowedUrl(o.apkUrl, mHost, allowTest)) throw new Error('Ссылка на APK не из доверенного источника');
  return {
    versionCode, versionName: o.versionName, changes: (o.changes as string[]).slice(0, 20), apkUrl: o.apkUrl, sha256: sha,
    size: typeof o.size === 'number' ? o.size : undefined, publishedAt: typeof o.publishedAt === 'string' ? o.publishedAt : null, manifestUrl,
  };
}
