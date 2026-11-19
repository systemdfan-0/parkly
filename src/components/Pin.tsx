import { useEffect, useRef, useState } from 'react';
import { usePin, type Msg } from '../pinStore';
import { useStore } from '../store';
import type { PinReply } from '../engine/pinReply';
import { Icon } from './Icon';
import { listenOnce, stopListening, voiceAvailable, VOICE_ERR } from '../voice';

/** Пин — пингвин в мятном шарфе. */
export function PinAvatar({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" className="pin-ava">
      <circle cx="20" cy="20" r="20" fill="#1E2228" />
      <path d="M20 4.5c-7.6 0-11.6 6-11.6 13.8 0 9 5 16.7 11.6 16.7s11.6-7.7 11.6-16.7C31.6 10.5 27.6 4.5 20 4.5Z" fill="#323A46" />
      <path d="M20 9c-1.8 0-3 .8-3.8 1.9-.8-.4-1.6-.6-2.4-.4-2.1.5-2.6 2.9-2.6 5.1 0 4.9 3.9 8.3 8.8 8.3s8.8-3.4 8.8-8.3c0-2.2-.5-4.6-2.6-5.1-.8-.2-1.6 0-2.4.4C23 9.8 21.8 9 20 9Z" fill="#F4F7F9" />
      <circle cx="16.4" cy="15.6" r="1.7" fill="#1E2228" /><circle cx="23.6" cy="15.6" r="1.7" fill="#1E2228" />
      <circle cx="16.9" cy="15" r=".55" fill="#fff" /><circle cx="24.1" cy="15" r=".55" fill="#fff" />
      <path d="M17.7 18.6h4.6L20 21.4Z" fill="#FFB547" />
      <ellipse cx="20" cy="30.2" rx="6" ry="4.3" fill="#F4F7F9" />
      <path d="M10.2 23.6c6.2 2.9 13.4 2.9 19.6 0l1 3.4c-6.7 3.1-14.9 3.1-21.6 0Z" fill="#3DDBB0" />
      <path d="M23.6 26.4l1.9 7.4 3.4-1-2.2-6.9Z" fill="#25B98F" />
    </svg>
  );
}

const EXAMPLES = ['Рядом со мной', 'У Хан Шатыра, до 500 тенге в час', 'Куда лучше встать у Достык Плазы через 15 минут?', 'Шымкент, ТРЦ Mega Planet', 'Что ты умеешь?'];

interface Props {
  onClose: () => void;
  onShow: (r: PinReply) => void;
}

/** Разговор с Пином (поле ввода — отдельно, в PinBar, чтобы клавиатура не закрывалась). */
export function Pin({ onClose, onShow }: Props) {
  const msgs = usePin((s) => s.msgs);
  const busy = usePin((s) => s.busy);
  const send = usePin((s) => s.send);
  const reset = usePin((s) => s.reset);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: msgs.length > 2 ? 'smooth' : 'auto' }); }, [msgs.length, busy]);

  const demo = () => {
    useStore.getState().pinDemo();
    reset();
    void send('У театра Абая через 5 минут').then(() => usePin.getState().send('а через 15?'));
  };

  return (
    <div className="pinbot">
      <div className="pinbot__top">
        <PinAvatar size={44} />
        <div><h2>Пин</h2><p className="muted small">Помощник Parkly. Считает на телефоне, без интернета</p></div>
        {msgs.length > 0 && <button className="icon-btn icon-btn--dark" onClick={reset} aria-label="Новый разговор"><Icon name="plus" /></button>}
        <button className="icon-btn icon-btn--dark" onClick={onClose} aria-label="Закрыть Пина"><Icon name="x" /></button>
      </div>

      {msgs.length === 0 && (
        <div className="bubble">
          <p>Напишите своими словами: куда, когда приедете и сколько готовы платить. Отвечу коротко и покажу парковку на карте, а потом расскажу про цену, места и часы работы.</p>
          <div className="chips">
            {EXAMPLES.map((e) => <button key={e} className="chip chip--ghost" onClick={() => send(e)}>{e}</button>)}
          </div>
          <button className="link small" onClick={demo}>Сценарий защиты: театр Абая, будни 18:25, 5 → 15 минут</button>
        </div>
      )}

      {msgs.map((m) => <Bubble key={m.id} m={m} onShow={onShow} />)}
      {busy && <div className="bubble bubble--pin bubble--typing" aria-label="Пин думает"><span /><span /><span /></div>}
      <div ref={end} className="pinbot__end" />
    </div>
  );
}

function Bubble({ m, onShow }: { m: Msg; onShow: (r: PinReply) => void }) {
  const act = usePin((s) => s.act);
  const choose = usePin((s) => s.choose);
  const send = usePin((s) => s.send);
  const [open, setOpen] = useState(false);
  if (m.from === 'me') return <div className="bubble bubble--me">{m.text}</div>;
  const r = m.reply;
  return (
    <div className="bubble bubble--pin" aria-live="polite">
      <p>{m.text}</p>
      {r?.details?.length ? (
        <>
          <button className="link small pinbot__more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? 'Скрыть подробности' : 'Подробнее и запасной вариант'}</button>
          {open && <ul className="pinbot__details">{r.details.map((d) => <li key={d}>{d}</li>)}</ul>}
        </>
      ) : null}
      {r?.source && (
        <p className="pinbot__src">
          {r.mode === 'demo'
            ? <><em className="src src--demo">демо</em><em className={`src ${r.source === 'ml' ? 'src--ml' : 'src--heur'}`}>{r.source === 'ml' ? 'ML-модель' : 'эвристика'}</em></>
            : <em className="src src--osm">каталог OSM</em>}
        </p>
      )}
      {m.suggest?.length ? (
        <div className="chips chips--suggest">
          {m.suggest.map((x) => <button key={x} className="chip chip--ghost" onClick={() => send(x)}>{x}</button>)}
        </div>
      ) : null}
      {(r?.show || r?.actions?.length || m.options?.length) && (
        <div className="row">
          {r?.show && <button className="btn btn--primary btn--sm" onClick={() => onShow(r)}><Icon name="map" size={16} /> На карте</button>}
          {r?.actions?.map((a) => <button key={a.label} className="btn btn--ghost btn--sm" onClick={() => act(a)}>{a.label}</button>)}
          {m.options?.map((h) => (
            <button key={h.place.id} className="chip" onClick={() => choose(h)}>{h.city && h.kind !== 'city' ? `${h.city.ru}: ${h.place.name}` : h.place.name}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Поле «Спросить Пина»: на карте над панелью; при открытом Пине — внизу панели или над клавиатурой. */
export function PinBar({ open, dock = false, onOpen, style }: { open: boolean; dock?: boolean; onOpen: () => void; style: React.CSSProperties }) {
  const [text, setText] = useState('');
  const send = usePin((s) => s.send);
  const busy = usePin((s) => s.busy);
  const input = useRef<HTMLInputElement>(null);
  const [mic, setMic] = useState<'off' | 'on' | 'none'>('off');
  useEffect(() => { let live = true; void voiceAvailable().then((ok) => { if (live && !ok) setMic('none'); }); return () => { live = false; }; }, []);
  const talk = async () => {
    if (mic === 'on') { stopListening(); setMic('off'); return; }
    if (!open) onOpen();
    setMic('on');
    const r = await listenOnce((t) => setText(t));
    setMic('off');
    if (r.ok) { setText(''); void send(r.text); }
    else { setText(''); usePin.getState().note(VOICE_ERR[r.why], r.why === 'nothing' ? ['Еду к театру Абая к 18:40'] : undefined); }
  };
  const submit = () => {
    const t = text.trim();
    if (!t) { input.current?.focus(); return; }
    setText('');
    if (!open) onOpen();
    void send(t);
  };
  return (
    <form className={`pinbar ${open ? 'pinbar--open' : ''} ${dock ? 'pinbar--dock' : ''}`} style={style} role="search" aria-label="Спросить Пина"
      onSubmit={(e) => { e.preventDefault(); submit(); }}>
      {!dock && <PinAvatar size={30} />}
      <input ref={input} value={text} onChange={(e) => setText(e.target.value)} onFocus={() => { if (!open) onOpen(); }}
        placeholder={open ? 'Сообщение Пину' : 'Спросить Пина'} enterKeyHint="send" autoComplete="off" aria-label="Сообщение Пину" />
      {mic !== 'none' && !text.trim() ? (
        <button type="button" className={`pinbar__send pinbar__mic ${mic === 'on' ? 'is-on' : ''}`} disabled={busy} onClick={talk}
          aria-label={mic === 'on' ? 'Остановить запись' : 'Сказать голосом'} aria-pressed={mic === 'on'}><Icon name="mic" size={20} /></button>
      ) : (
        <button type="submit" className="pinbar__send" disabled={busy} aria-label="Отправить"><Icon name="up" size={20} /></button>
      )}
    </form>
  );
}
