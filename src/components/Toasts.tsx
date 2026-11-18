import { useEffect } from 'react';
import { useStore } from '../store';
import { Icon } from './Icon';
import { useOpenLot } from './Saved';

export function Toasts() {
  const notices = useStore((s) => s.notices);
  const dismiss = useStore((s) => s.dismissNotice);
  const open = useOpenLot();

  useEffect(() => {
    const timers = notices.map((n) => setTimeout(() => dismiss(n.id), n.kind === 'spot' || n.kind === 'check' ? 15000 : 4200));
    return () => timers.forEach(clearTimeout);
  }, [notices, dismiss]);

  if (!notices.length) return null;
  return (
    <div className="toasts" aria-live="polite">
      {notices.slice(-2).reverse().map((n) => (
        <div key={n.id} className={`toast toast--${n.kind}`} role={n.kind === 'spot' ? 'alert' : 'status'}>
          <Icon name={n.kind === 'spot' ? 'bell' : n.kind === 'success' ? 'check' : n.kind === 'check' ? 'clock' : 'info'} size={20} />
          <div className="toast__body">
            <b>{n.title}</b>
            {n.text && <span>{n.text}</span>}
            {n.kind === 'spot' && n.lotId && (
              <button className="btn btn--primary btn--sm" onClick={() => { open(n.lotId!); dismiss(n.id); }}>Открыть и забронировать</button>
            )}
          </div>
          <button className="icon-btn" onClick={() => dismiss(n.id)} aria-label="Закрыть"><Icon name="x" size={16} /></button>
        </div>
      ))}
    </div>
  );
}
