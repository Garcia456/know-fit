import type { WeightPoint } from '../api/types';
import { formatMd, formatNumber } from '../lib/format';

/** 体重点折线；点数少于 2 时调用方不渲染。 */
export function WeightChart({ points }: { points: WeightPoint[] }) {
  const width = 320;
  const vals = points.map((p) => p.weight_kg);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const coords = points.map((p, i) => {
    const x = 6 + (i * (width - 12)) / (points.length - 1);
    const y = 12 + (1 - (p.weight_kg - min) / span) * 60;
    return { x, y };
  });
  const first = points[0];
  const lastPoint = points[points.length - 1];
  const last = coords[coords.length - 1];
  const mid = points[Math.floor(points.length / 2)] ?? first;
  if (!first || !lastPoint || !last || !mid) return null;

  return (
    <div className="spark-line">
      <svg
        width="100%"
        height="84"
        viewBox={`0 0 ${width} 84`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`体重折线：${points
          .map((p) => `${formatMd(p.date)} ${formatNumber(p.weight_kg)} 千克`)
          .join('，')}`}
      >
        <line x1="0" y1="20" x2={width} y2="20" stroke="#E6E6E6" strokeWidth="1" />
        <line x1="0" y1="46" x2={width} y2="46" stroke="#E6E6E6" strokeWidth="1" />
        <line x1="0" y1="72" x2={width} y2="72" stroke="#E6E6E6" strokeWidth="1" />
        <polyline
          points={coords.map((c) => `${c.x},${c.y}`).join(' ')}
          fill="none"
          stroke="#2C2C2C"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle cx={last.x} cy={last.y} r="4" fill="#1E1E1E" />
      </svg>
      <div className="axis">
        <span>{formatMd(first.date)}</span>
        <span>{formatMd(mid.date)}</span>
        <span>{formatMd(lastPoint.date)}</span>
      </div>
    </div>
  );
}