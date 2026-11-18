export function plural(n: number, forms: [string, string, string]) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
export const spots = (n: number) => `${n} ${plural(n, ['место', 'места', 'мест'])}`;
export const spotsWord = (n: number) => plural(n, ['место', 'места', 'мест']);
export const pctText = (p: number) => `${Math.round(p * 100)}%`;
export type Level = 'ok' | 'tight' | 'full' | 'off';
export const levelOf = (p: number, available = true): Level => (!available ? 'off' : p >= 0.85 ? 'ok' : p >= 0.5 ? 'tight' : 'full');
