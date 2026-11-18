import { useEffect, useState } from 'react';
import { useUpdates } from '../updates/store';
import { Updates, isNative } from '../updates/native';
import { CHANNEL_LABEL, RELEASE } from '../updates/manifest';
import { Modal } from './Modal';
import { Icon } from './Icon';

const mb = (b?: number) => (b ? `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} МБ` : '');
const host = (u: string) => { try { return new URL(u).host; } catch { return u; } };

/** «Что нового» и кнопка «Скачать APK». Установку подтверждает стандартное окно Android. */
export function UpdateScreen() {
  const { last, info, checking, check, closeScreen, channel } = useUpdates();
  const [dl, setDl] = useState<{ state: 'idle' | 'loading' | 'done' | 'error' | 'perm'; pct?: number; msg?: string }>({ state: 'idle' });
  useEffect(() => {
    const h = Updates.addListener('downloadProgress', (p) => setDl({ state: 'loading', pct: p.total > 0 ? Math.round((p.done / p.total) * 100) : undefined }));
    return () => { h.then((x) => x.remove()); };
  }, []);
  const m = last?.manifest;
  const isNew = last?.status === 'update' && m;

  const download = async () => {
    if (!m) return;
    setDl({ state: 'loading' });
    try {
      const r = await Updates.download({ apkUrl: m.apkUrl, sha256: m.sha256, manifestUrl: m.manifestUrl, versionName: m.versionName });
      setDl(r.status === 'needs-permission'
        ? { state: 'perm', msg: 'Разрешите Parkly устанавливать приложения в открывшихся настройках, вернитесь и нажмите «Скачать APK» ещё раз.' }
        : { state: 'done', msg: isNative ? 'Файл проверен (sha256). Подтвердите установку в окне Android.' : 'Скачивание открыто в браузере.' });
    } catch (e) {
      setDl({ state: 'error', msg: (e as Error).message });
    }
  };

  return (
    <Modal onClose={closeScreen} label="Обновление приложения" wide>
      <h2 className="modal__title"><Icon name="ff" size={18} /> {isNew ? `Вышла Parkly ${m.versionName}` : 'Обновления'}</h2>
      <p className="muted small">Установлена версия {info?.versionName ?? RELEASE.versionName} (код {info?.versionCode ?? RELEASE.versionCode}). Канал: {CHANNEL_LABEL[channel]}.</p>

      {checking && <p>Проверяю…</p>}
      {!checking && last?.status === 'current' && <div className="banner banner--ok"><Icon name="check" size={18} /><span>У вас последняя версия. На сервере — {m?.versionName} (код {m?.versionCode}).</span></div>}
      {!checking && last?.status === 'offline' && <div className="banner banner--warn"><Icon name="info" size={18} /><span>Нет связи с сервером обновлений. Приложение работает офлайн; проверим снова в фоне, когда появится сеть.</span></div>}
      {!checking && last?.status === 'error' && <div className="banner banner--off"><Icon name="info" size={18} /><span>Не удалось проверить: {last.error}</span></div>}
      {!checking && last?.status === 'not-configured' && (
        <div className="banner banner--warn"><Icon name="info" size={18} />
          <span>Адрес релизов не настроен. Укажите HTTPS-адрес манифеста в <code>release.config.json</code> → <code>manifestUrl</code> и пересоберите APK. Для проверки выберите тестовый канал в демо-панели.</span></div>
      )}

      {isNew && (
        <>
          <h3>Что нового</h3>
          <ul className="method">{m.changes.map((c) => <li key={c}>{c}</li>)}</ul>
          <p className="muted small">
            Источник: {host(m.apkUrl)}{m.size ? `, ${mb(m.size)}` : ''}{m.publishedAt ? `, ${m.publishedAt}` : ''}.
            {m.sha256 ? ' Контрольная сумма проверяется после скачивания.' : ''}
          </p>
          {dl.state === 'loading' && <p className="small">Скачиваю{dl.pct != null ? `: ${dl.pct}%` : '…'}</p>}
          {dl.msg && <div className={`banner ${dl.state === 'error' ? 'banner--off' : 'banner--warn'}`}><Icon name="info" size={18} /><span>{dl.msg}</span></div>}
          <button className="btn btn--primary btn--full" onClick={download} disabled={dl.state === 'loading'}>Скачать APK</button>
          <p className="muted small">Android покажет стандартное окно «Установить обновление?». Данные приложения сохранятся.</p>
        </>
      )}
      <button className="btn btn--ghost btn--full" onClick={() => check({ manual: true })} disabled={checking}>Проверить обновления</button>
    </Modal>
  );
}

/** Обновление внутри приложения — когда системные уведомления выключены. */
export function UpdateBanner() {
  const { banner, openScreen, dismissBanner } = useUpdates();
  if (!banner) return null;
  return (
    <div className="toasts toasts--update">
      <div className="toast toast--spot" role="status">
        <Icon name="ff" size={20} />
        <div className="toast__body">
          <b>Доступна Parkly {banner.versionName}</b>
          <span>{banner.changes[0]}</span>
          <button className="btn btn--primary btn--sm" onClick={openScreen}>Что нового</button>
        </div>
        <button className="icon-btn" onClick={dismissBanner} aria-label="Закрыть"><Icon name="x" size={16} /></button>
      </div>
    </div>
  );
}

/** Блок «Приложение»: версия, проверка, состояние уведомлений. */
export function AppSection() {
  const { info, check, openScreen, refreshInfo } = useUpdates();
  useEffect(() => { void refreshInfo(); }, [refreshInfo]);
  return (
    <>
      <h3>Приложение</h3>
      <div className="appinfo">
        <p>Parkly {info?.versionName ?? RELEASE.versionName} <span className="muted">(код {info?.versionCode ?? RELEASE.versionCode})</span></p>
        <p className="muted small">
          Уведомления о новых версиях: {info?.notificationsEnabled ? 'включены' : 'выключены — покажем внутри приложения при запуске'}.
        </p>
        <div className="row">
          <button className="btn btn--dark btn--sm" onClick={async () => { openScreen(); await check({ manual: true }); }}>Проверить обновления</button>
          {!info?.notificationsEnabled && isNative && (
            <button className="btn btn--ghost btn--sm" onClick={async () => { await Updates.requestNotifications(); await refreshInfo(); }}>Включить уведомления</button>
          )}
        </div>
      </div>
    </>
  );
}
