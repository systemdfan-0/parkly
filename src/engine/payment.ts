// Попытка демо-оплаты Kaspi: «оплачиваю…» → оплачено. Отмена до конца гасит таймер — бронь и чек не появятся.

export type PayState = 'paying' | 'paid' | 'cancelled';
export interface PayAttempt { readonly state: PayState; cancel(): boolean }

export const PAY_MS = 1400;

export function startPayment(onPaid: () => void, ms = PAY_MS): PayAttempt {
  let state: PayState = 'paying';
  const t = setTimeout(() => { if (state !== 'paying') return; state = 'paid'; onPaid(); }, ms);
  return {
    get state() { return state; },
    cancel() { if (state !== 'paying') return false; state = 'cancelled'; clearTimeout(t); return true; },
  };
}

/** Тестовый платёж с точки каталога OSM: фиксированная сумма, без брони места. */
export const DEMO_PAY = { amount: 600, durationMin: 120 } as const;

const CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const receiptNo = () => `PK-${Array.from({ length: 4 }, () => CH[Math.floor(Math.random() * CH.length)]).join('')}${Math.floor(Math.random() * 900 + 100)}`;
