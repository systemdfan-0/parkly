// Кнопка «По факту занято» в карточке парковки: ответ на «паркуются вторым рядом, правила не соблюдают».
import { useReports, freshReport, REPORT_TEXT, REPORT_TTL_MIN, type ReportKind } from '../engine/reports';
import { Icon } from './Icon';

export function ReportBox({ lotId, now, demo }: { lotId: string; now: number; demo: boolean }) {
  useReports((s) => s.reports[lotId]); // перерисовка после отметки
  const r = freshReport(lotId, now);
  const { report, clear } = useReports.getState();
  const mark = (k: ReportKind) => report(lotId, k, now);
  if (r) {
    return (
      <div className="report report--on">
        <Icon name="info" size={18} />
        <span>Вы отметили {r.ago ? `${r.ago} мин назад` : 'только что'}: <b>{REPORT_TEXT[r.kind]}</b>.
          {demo ? ' Пин считает шанс здесь ниже и предлагает другие парковки.' : ' Пин ставит её ниже в подборе.'} Отметка действует {REPORT_TTL_MIN} мин.</span>
        <button className="btn btn--ghost btn--sm" onClick={() => clear(lotId)}>Убрать</button>
      </div>
    );
  }
  return (
    <div className="report">
      <p className="muted small">Приехали, а мест нет? Отметьте — прогноз здесь станет осторожнее.</p>
      <div className="row">
        <button className="btn btn--ghost btn--sm" onClick={() => mark('full')}>По факту занято</button>
        <button className="btn btn--ghost btn--sm" onClick={() => mark('double')}>Паркуются вторым рядом</button>
      </div>
    </div>
  );
}
