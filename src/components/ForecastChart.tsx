import type { Forecast } from '../engine/model';
import { MIN, fmtTime } from '../engine/time';

/** Свободные места на ближайший час: полоса — 60% вероятный диапазон, линия — медиана. */
export function ForecastChart({ fc, now, eta, ml = [] }: { fc: Forecast; now: number; eta: number; ml?: { t: number; lo: number; mid: number; hi: number }[] }) {
  const W = 320, H = 120, L = 28, R = 8, T = 12, B = 22;
  const s = fc.series;
  if (s.length < 2) return null;
  const tMax = s[s.length - 1].t;
  const yMax = Math.max(4, ...s.map((p) => p.hi), ...ml.map((p) => p.hi)) * 1.15;
  const x = (t: number) => L + ((t - now) / (tMax - now)) * (W - L - R);
  const y = (v: number) => T + (1 - v / yMax) * (H - T - B);
  const band = [...s.map((p) => `${x(p.t)},${y(p.hi)}`), ...[...s].reverse().map((p) => `${x(p.t)},${y(p.lo)}`)].join(' ');
  const mid = s.map((p, i) => `${i ? 'L' : 'M'}${x(p.t)},${y(p.mid)}`).join(' ');
  const ex = x(Math.min(eta, tMax));
  const ticks = [0, 15, 30, 45, 60].map((m) => now + m * MIN).filter((t) => t <= tMax);
  const yTicks = [0, Math.round(yMax / 2), Math.floor(yMax)].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`Прогноз свободных мест на час: сейчас ${s[0].mid}, через час ${s[s.length - 1].lo}–${s[s.length - 1].hi}`}>
      {yTicks.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="chart__grid" />
          <text x={L - 6} y={y(v) + 4} className="chart__ax" textAnchor="end">{v}</text>
        </g>
      ))}
      {ticks.map((t) => <text key={t} x={x(t)} y={H - 6} className="chart__ax" textAnchor="middle">{fmtTime(t)}</text>)}
      <polygon points={band} className="chart__band" />
      <path d={mid} className="chart__mid" />
      <line x1={ex} x2={ex} y1={T - 4} y2={H - B} className="chart__eta" />
      <text x={ex + 4} y={T + 2} className="chart__etaL">приезд</text>
      {ml.map((p) => (
        <g key={p.t}>
          <line x1={x(p.t)} x2={x(p.t)} y1={y(p.lo)} y2={y(p.hi)} className="chart__mlbar" />
          <circle cx={x(p.t)} cy={y(p.mid)} r={3.5} className="chart__ml" />
        </g>
      ))}
      <circle cx={x(now)} cy={y(s[0].mid)} r={4} className="chart__now" />
    </svg>
  );
}
