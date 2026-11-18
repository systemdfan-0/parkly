// Пин — помощник Parkly. Реплики собираются из данных подбора (recommend) и прогноза ML-модели:
// никаких заготовленных ответов и внешних сервисов, всё считается на устройстве.
import type { Option, Priority, Result } from './recommend';
import { PRIORITY_LABEL, rangeText } from './recommend';
import { tenge } from './pricing';
import { fmtTime, fmtDur } from './time';
import { spotsWord } from '../format';

export interface PinFact { icon: string; text: string }
export interface PinAnswer {
  best: Option;
  backup: Option | null;
  headline: string;
  facts: PinFact[];
  why: string;
  backupText: string | null;
  sourceNote: string | null;
}

const pct = (p: number) => `${Math.round(p * 100)}%`;
const price = (o: Option) => (o.price.total ? `${tenge(o.price.total)} за ${fmtDur(o.durationMin)}` : 'бесплатно');
const fcText = (o: Option) => `к ${fmtTime(o.eta)} ${rangeText(o.fc)} ${spotsWord(o.fc.hi)}`;

export function pinAnswer(r: Result, priority: Priority): PinAnswer | null {
  const av = r.options.filter((o) => o.available);
  if (!av.length) return null;
  const best = av[0];
  // запасной — следующий по оценке, но с надёжным прогнозом, если такой есть
  const rest = av.slice(1);
  const backup = rest.find((o) => o.fc.pFree >= 0.9) ?? rest[0] ?? null;

  const facts: PinFact[] = [
    { icon: 'walk', text: `${best.walkMin} мин пешком` },
    { icon: 'wallet', text: price(best) },
    { icon: 'clock', text: `${fcText(best)}, шанс ${pct(best.fc.pFree)}` },
  ];

  // «почему» — сравнение с тем вариантом, который выглядел бы очевиднее
  const closest = [...av].sort((a, b) => a.walkMin - b.walkMin)[0];
  const cheapest = [...av].sort((a, b) => a.price.total - b.price.total)[0];
  let why: string;
  if (closest !== best && closest.fc.pFree + 0.03 < best.fc.pFree) {
    why = `«${closest.lot.short}» ближе на ${best.walkMin - closest.walkMin} мин, но ${fcText(closest)}, шанс ${pct(closest.fc.pFree)}`
      + (closest.trendText ? ` — ${closest.trendText}.` : '.');
  } else if (cheapest !== best && cheapest.price.total < best.price.total) {
    why = `«${cheapest.lot.short}» дешевле на ${tenge(best.price.total - cheapest.price.total)}, но идти ${cheapest.walkMin} мин`
      + (cheapest.lot.bookable ? '.' : ' и без брони.');
  } else if (closest === best) {
    why = `Ближе всех ко входу, и места к приезду будут: шанс ${pct(best.fc.pFree)}` + (best.trendText ? `, хотя ${best.trendText}.` : '.');
  } else {
    why = best.reason;
  }
  if (priority !== 'balanced') why = `Вы выбрали «${PRIORITY_LABEL[priority]}». ` + why;

  const backupText = backup
    ? `Запасной: «${backup.lot.short}» — ${backup.walkMin} мин пешком, ${price(backup)}, ${fcText(backup)} (${pct(backup.fc.pFree)}).`
    : null;
  const sourceNote = best.fcSource === 'heuristic'
    ? `До приезда ${best.driveMin} мин — это дальше 15 минут, поэтому прогноз считает эвристика, а не ML-модель.`
    : null;
  return { best, backup, headline: `Езжайте на «${best.lot.name}».`, facts, why, backupText, sourceNote };
}

/** Почему рекомендация поменялась после смены времени приезда или приоритета. */
export function pinChange(prevBest: Option | undefined, prevArrive: string, now: Result, curArrive: string): string | null {
  if (!prevBest) return null;
  const cur = now.options.find((o) => o.available);
  if (!cur || cur.lot.id === prevBest.lot.id) return null;
  const same = now.options.find((o) => o.lot.id === prevBest.lot.id);
  if (!same || !same.available) return `${prevArrive} я советовал «${prevBest.lot.short}», но ${curArrive.toLowerCase()} она уже недоступна: ${same?.unavailable ?? 'закрыта'}.`;
  return `${prevArrive} я советовал «${prevBest.lot.short}». ${curArrive} там ${fcText(same)}, шанс ${pct(same.fc.pFree)}`
    + (same.trendText ? ` — ${same.trendText}.` : '.');
}
