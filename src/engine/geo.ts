import { parts, isWeekend } from './time';

export function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371e3, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLon = (bLon - aLon) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export const WALK_M_PER_MIN = 75;     // ≈ 4,5 км/ч
export const WALK_DETOUR = 1.3;       // пешеходный путь длиннее прямой линии
export const ROAD_DETOUR = 1.35;      // дорога длиннее прямой линии

/** Средняя скорость в городе по часам — эвристика пробок Алматы. */
export function citySpeedKmh(ms: number): number {
  const h = parts(ms).h;
  if (isWeekend(ms)) return h < 7 ? 38 : h < 11 ? 32 : h < 21 ? 26 : 34;
  if (h < 7) return 38;
  if (h < 8) return 26;
  if (h < 10) return 17;
  if (h < 17) return 24;
  if (h < 20) return 16;
  if (h < 21) return 22;
  return 32;
}

export function driveMinutes(meters: number, ms: number): number {
  return Math.max(3, Math.round((meters * ROAD_DETOUR) / 1000 / citySpeedKmh(ms) * 60) + 2);
}

export const fmtDist = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} м` : m < 10_000 ? `${(m / 1000).toFixed(1).replace('.', ',')} км` : `${Math.round(m / 1000)} км`);
