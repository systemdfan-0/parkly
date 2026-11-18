import { useStore, selectFree } from '../store';
import { SCENARIOS } from '../engine/scenarios';
import { LOT_BY_ID } from '../data/places';
import { fmtTime, fmtDow, fmtDate } from '../engine/time';
import { rangeText, type Option } from '../engine/recommend';
import { Modal } from './Modal';
import { Icon } from './Icon';
import { useUpdates } from '../updates/store';
import { Updates, isNative } from '../updates/native';
import { CHANNEL_LABEL, type Channel } from '../updates/manifest';

const SPEEDS = [0, 1, 10, 60];

export function DemoPanel({ onClose, selected }: { onClose: () => void; selected: Option | null }) {
  const sim = useStore((s) => s.sim);
  const setScenario = useStore((s) => s.setScenario);
  const setSpeed = useStore((s) => s.setSpeed);
  const jump = useStore((s) => s.jump);
  const demoFill = useStore((s) => s.demoFill);
  const demoRelease = useStore((s) => s.demoRelease);
  const resetDemo = useStore((s) => s.resetDemo);
  const toggleWatch = useStore((s) => s.toggleWatch);
  const watches = useStore((s) => s.watches);
  const pushNotice = useStore((s) => s.pushNotice);
  const lot = selected?.lot;
  const free = useStore((s) => (lot ? selectFree(s, lot.id) : 0));

  /** Перемотка до приезда + проверка: попал ли факт в прогноз. */
  const checkForecast = () => {
    if (!selected) { jump(15); return; }
    const { fc, driveMin, eta, fcSource } = selected;
    jump(driveMin);
    const fact = selectFree(useStore.getState(), selected.lot.id);
    const hit = fact >= fc.lo && fact <= fc.hi;
    pushNotice({ kind: 'check', title: `Проверка прогноза ${hit ? 'пройдена' : '— промах'}`,
      text: `${selected.lot.short}: ${fcSource === 'ml' ? 'ML-модель ждала' : 'эвристика ждала'} ${rangeText(fc)} к ${fmtTime(eta)}, по факту ${fact}.${hit ? '' : ' Прогноз даёт 60%-й диапазон, иногда факт выходит за него.'}` });
    onClose();
  };

  return (
    <Modal onClose={onClose} label="Демо-режим" wide>
      <h2 className="modal__title"><Icon name="flask" size={18} /> Демо-режим</h2>
      <p className="muted small">Сейчас {fmtDow(sim.now, true)}, {fmtDate(sim.now)}, {fmtTime(sim.now)}. Данные о местах симулируются моделью «въезд/выезд»; брони, отмена и уведомления работают по-настоящему.</p>

      <h3>Время</h3>
      <div className="chips">
        {SCENARIOS.map((s) => (
          <button key={s.id} className={`chip ${sim.scenarioId === s.id ? 'chip--on' : ''}`} onClick={() => setScenario(s.id)} title={s.hint}>{s.label}</button>
        ))}
      </div>
      <p className="muted small">{SCENARIOS.find((s) => s.id === sim.scenarioId)?.hint}. Смена сценария отменяет активные брони.</p>

      <h3>Скорость</h3>
      <div className="row">
        <div className="seg" role="radiogroup" aria-label="Скорость времени">
          {SPEEDS.map((v) => (
            <button key={v} role="radio" aria-checked={sim.speed === v} className={sim.speed === v ? 'on' : ''} onClick={() => setSpeed(v)}>
              {v === 0 ? <><Icon name="pause" size={14} /> Пауза</> : `×${v}`}
            </button>
          ))}
        </div>
        <button className="btn btn--ghost btn--sm" onClick={() => jump(5)}>+5 мин</button>
      </div>

      <h3>Проверить прогноз</h3>
      <button className="btn btn--dark btn--full" onClick={checkForecast}>
        <Icon name="ff" size={16} /> {selected ? `Перемотать до приезда (${selected.driveMin} мин) и сравнить` : 'Перемотать на 15 минут'}
      </button>

      <h3>Уведомление о месте</h3>
      {lot ? (
        <>
          <p className="small">«{lot.short}»: свободно {free}{watches.includes(lot.id) ? ', отслеживается' : ''}.</p>
          <div className="steps">
            <button className="btn btn--ghost btn--sm" onClick={() => demoFill(lot.id)}>1. Занять все места</button>
            <button className="btn btn--ghost btn--sm" onClick={() => { if (!watches.includes(lot.id)) toggleWatch(lot.id); }} disabled={watches.includes(lot.id)}>2. Следить</button>
            <button className="btn btn--primary btn--sm" onClick={() => { demoRelease(lot.id, 3); onClose(); }}>3. Три машины уехали</button>
          </div>
          <p className="muted small">Уведомление приходит, когда на отслеживаемой парковке было 0 мест и появилось хотя бы одно. На загруженной парковке места быстро занимают снова — бронируйте сразу.</p>
        </>
      ) : <p className="muted small">Выберите парковку на карте или в списке — здесь появятся кнопки сценария.</p>}

      <UpdatesDemo onClose={onClose} />

      <h3>Сброс</h3>
      <button className="btn btn--ghost btn--full" onClick={() => { if (confirm('Сбросить брони, избранное и время к исходному демо?')) { resetDemo(); onClose(); } }}>
        Сбросить демо-данные
      </button>
      {lot && <p className="muted small">Ёмкость «{lot.short}»: {LOT_BY_ID[lot.id].capacity} мест.</p>}
    </Modal>
  );
}

/** Тестовые каналы обновлений — пока не настроен хостинг релизов. */
function UpdatesDemo({ onClose }: { onClose: () => void }) {
  const { channel, setChannel, check, openScreen, info, refreshInfo } = useUpdates();
  return (
    <>
      <h3>Обновления приложения</h3>
      <div className="chips">
        {(Object.keys(CHANNEL_LABEL) as Channel[]).map((c) => (
          <button key={c} className={`chip ${channel === c ? 'chip--on' : ''}`} onClick={() => setChannel(c)}>{CHANNEL_LABEL[c]}</button>
        ))}
      </div>
      <div className="steps">
        <button className="btn btn--ghost btn--sm" onClick={async () => { onClose(); openScreen(); await check({ manual: true }); }}>Проверить сейчас</button>
        {isNative && <button className="btn btn--ghost btn--sm" onClick={async () => { await Updates.runWorkerNow(); setTimeout(refreshInfo, 3000); }}>Фоновая проверка (WorkManager)</button>}
        {isNative && <button className="btn btn--ghost btn--sm" onClick={async () => { await Updates.resetNotified(); await refreshInfo(); }}>Забыть показанное уведомление</button>}
      </div>
      <p className="muted small">
        Тестовые манифесты отдаёт <code>npm run release:test-server</code> на компьютере (в эмуляторе — 10.0.2.2).
        {info?.lastResult ? ` Последняя проверка (${info.lastSource === 'worker' ? 'фон' : 'приложение'}): ${info.lastResult}.` : ''}
      </p>
    </>
  );
}
