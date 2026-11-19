// «По факту занято»: водитель отмечает, что на парковке мест нет (вторым рядом, заняли нарушители).
// Свежая отметка (до 45 минут) снижает шанс этой парковки в подборе и показывается в карточке.
// Сейчас отметки хранятся на этом телефоне; в рабочей версии их собирали бы от всех водителей.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type ReportKind = 'full' | 'double';
export interface Report { at: number; kind: ReportKind }
export const REPORT_TTL_MIN = 45;
/** Во сколько раз падает шанс найти место после свежей отметки. */
export const REPORT_FACTOR = 0.35;

interface ReportState {
  reports: Record<string, Report>;
  report: (lotId: string, kind: ReportKind, at: number) => void;
  clear: (lotId: string) => void;
}

export const useReports = create<ReportState>()(
  persist(
    (set) => ({
      reports: {},
      report: (lotId, kind, at) => set((s) => ({ reports: { ...s.reports, [lotId]: { at, kind } } })),
      clear: (lotId) => set((s) => { const r = { ...s.reports }; delete r[lotId]; return { reports: r }; }),
    }),
    { name: 'parkly-reports', storage: createJSONStorage(() => localStorage) },
  ),
);

/** Свежая отметка для парковки на момент now (время демо или реальное), иначе null. */
export function freshReport(lotId: string, now: number): (Report & { ago: number }) | null {
  const r = useReports.getState().reports[lotId];
  if (!r) return null;
  const ago = Math.round((now - r.at) / 60_000);
  return ago >= -5 && ago <= REPORT_TTL_MIN ? { ...r, ago: Math.max(0, ago) } : null;
}

export const REPORT_TEXT: Record<ReportKind, string> = { full: 'по факту мест нет', double: 'паркуются вторым рядом' };
