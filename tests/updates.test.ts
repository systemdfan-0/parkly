import { describe, expect, test, vi, beforeEach } from 'vitest';
import { validateManifest, isAllowedUrl, manifestUrlFor, RELEASE } from '../src/updates/manifest';
import { Updates } from '../src/updates/native';
import { useUpdates } from '../src/updates/store';

const NEXT = RELEASE.versionCode + 1;
const base = { versionCode: NEXT, versionName: 'next', changes: ['Новое'], apkUrl: 'https://github.com/x/parkly/releases/download/v1.1/Parkly.apk' };

describe('манифест релиза', () => {
  test('корректный манифест принимается', () => {
    const m = validateManifest({ ...base, sha256: 'a'.repeat(64) }, 'https://example.org/m.json', false);
    expect(m.versionCode).toBe(NEXT);
  });
  test('ссылка не из доверенного источника и не по HTTPS отклоняется', () => {
    expect(() => validateManifest({ ...base, apkUrl: 'https://evil.example/p.apk' }, 'https://example.org/m.json', false)).toThrow(/доверенного/);
    expect(() => validateManifest({ ...base, apkUrl: 'http://github.com/p.apk' }, 'https://example.org/m.json', false)).toThrow(/доверенного/);
    // APK на том же хосте, что и манифест, разрешён
    expect(validateManifest({ ...base, apkUrl: 'https://example.org/p.apk' }, 'https://example.org/m.json', false).apkUrl).toContain('example.org');
  });
  test('тестовый сервер разрешён только в отладке', () => {
    const u = `http://10.0.2.2:${RELEASE.testServerPort}/Parkly.apk`;
    expect(isAllowedUrl(u, null, true)).toBe(true);
    expect(isAllowedUrl(u, null, false)).toBe(false);
    expect(isAllowedUrl(`http://10.0.2.2:9999/x.apk`, null, true)).toBe(false);
  });
  test('без списка изменений или с битым sha256 — ошибка', () => {
    expect(() => validateManifest({ ...base, changes: [] }, 'https://example.org/m.json', false)).toThrow(/изменений/);
    expect(() => validateManifest({ ...base, sha256: 'xyz' }, 'https://example.org/m.json', false)).toThrow(/sha256/);
  });
});

describe('проверка обновлений (веб-путь)', () => {
  beforeEach(() => { useUpdates.setState({ banner: null, seenInAppCode: 0, last: null }); });
  const serve = (body: unknown, ok = true) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body })));

  test('та же версия — «последняя версия», баннера нет', async () => {
    serve({ ...base, versionCode: RELEASE.versionCode, versionName: RELEASE.versionName });
    await Updates.configure({ manifestUrl: 'https://example.org/m.json' });
    useUpdates.setState({ channel: 'release' });
    const r = await Updates.check({ notify: true });
    expect(r.status).toBe('current');
  });

  test('новая версия при запуске — баннер внутри приложения один раз для версии', async () => {
    serve(base);
    vi.spyOn(Updates, 'configure').mockResolvedValue();
    await Updates.configure({ manifestUrl: 'https://example.org/m.json' });
    const st = useUpdates.getState();
    const r = await st.check({ manual: false });
    expect(r.status).toBe('update');
    expect(useUpdates.getState().banner?.versionCode).toBe(NEXT);
    useUpdates.getState().dismissBanner();
    await useUpdates.getState().check({ manual: false }); // повторная проверка
    expect(useUpdates.getState().banner).toBeNull();
  });

  test('нет сети — статус offline, приложение не падает', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const r = await Updates.check({ notify: true });
    expect(r.status).toBe('offline');
  });

  test('адрес релизов не задан — not-configured', async () => {
    vi.restoreAllMocks();
    await Updates.configure({ manifestUrl: manifestUrlFor('release', false) });
    if (!RELEASE.manifestUrl) expect((await Updates.check({ notify: true })).status).toBe('not-configured');
  });
});
