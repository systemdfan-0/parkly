// Ссылка «в навигатор». На Android — geo:, откроется выбор приложения (2ГИС, Яндекс, Google Maps);
// в браузере — маршрут Google Maps. Точка — въезд, если он известен, иначе сама парковка.
import { Capacitor } from '@capacitor/core';

export interface NavTarget { lat: number; lon: number; entr?: [number, number] | null; label: string }

export function navLink(t: NavTarget, walk = false): { href: string; text: string; toEntrance: boolean } {
  const [lat, lon] = t.entr ?? [t.lat, t.lon];
  const toEntrance = !!t.entr;
  const label = toEntrance ? `Въезд: ${t.label}` : t.label;
  const native = Capacitor.isNativePlatform() || /Android/i.test(typeof navigator === 'undefined' ? '' : navigator.userAgent);
  const href = native
    ? `geo:${lat},${lon}?q=${lat},${lon}(${encodeURIComponent(label)})`
    : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=${walk ? 'walking' : 'driving'}`;
  return { href, text: walk ? 'Маршрут пешком' : toEntrance ? 'Ко въезду' : 'К парковке', toEntrance };
}
