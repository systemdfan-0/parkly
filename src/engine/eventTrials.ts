import { DEFAULT_EVENT, simulateEvent, type ModeResult } from './event';

export const EVENT_TRIAL_COUNT = 30;

function emptyTotals() {
  return { full: 0, drove: 0, leftArea: 0, walkTotal: 0 };
}

function addTotals(totals: ReturnType<typeof emptyTotals>, result: ModeResult, full: number) {
  totals.full += full;
  totals.drove += result.chose;
  totals.leftArea += result.leftArea;
  totals.walkTotal += result.avgWalk * (result.chose - result.leftArea);
}

function summarize({ full, drove, leftArea, walkTotal }: ReturnType<typeof emptyTotals>) {
  const parked = drove - leftArea;
  return { full, drove, leftArea, fullShare: drove ? full / drove : 0, avgWalk: parked ? walkTotal / parked : null };
}

export function compareEventTrials(cars: number) {
  const a = emptyTotals();
  const b = emptyTotals();
  let better = 0;
  let same = 0;
  let worse = 0;
  let moreLeft = 0;
  let hardest: { seed: number; fullDelta: number } | null = null;
  let worseParking: { seed: number; extra: number } | null = null;

  for (let seed = 1; seed <= EVENT_TRIAL_COUNT; seed++) {
    const settings = { ...DEFAULT_EVENT, cars, seed };
    const separate = simulateEvent(settings, 'independent');
    const coordinated = simulateEvent(settings, 'aware');
    const fullDelta = coordinated.fullShare - separate.fullShare;
    const extra = coordinated.leftArea - separate.leftArea;
    if (fullDelta < 0) better++;
    else if (fullDelta > 0) worse++;
    else same++;
    if (extra > 0) {
      moreLeft++;
      if (!worseParking || extra > worseParking.extra) worseParking = { seed, extra };
    }
    if (!hardest || fullDelta > hardest.fullDelta) hardest = { seed, fullDelta };
    addTotals(a, separate, separate.lots.reduce((sum, lot) => sum + lot.fullArrivals, 0));
    addTotals(b, coordinated, coordinated.lots.reduce((sum, lot) => sum + lot.fullArrivals, 0));
  }

  return { a: summarize(a), b: summarize(b), better, same, worse, moreLeft, hardest, worseParking };
}
