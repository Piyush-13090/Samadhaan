import type { TrendPoint } from '@samadhaan/shared';
import { formatNumber } from '@/lib/format';

const WIDTH = 640;
const HEIGHT = 160;
const PAD = { top: 8, right: 4, bottom: 22, left: 28 };

/**
 * Reports and resolutions per day.
 *
 * An inline SVG — no chart library for two series. Reported days are bars,
 * resolved days are dots on a line, so the two differ by shape as well as
 * colour. The picture is `aria-hidden`; screen readers get a one-line summary
 * and the same numbers as a table.
 */
export function CivicTrendChart({ points }: { points: TrendPoint[] }) {
  const max = Math.max(1, ...points.flatMap((point) => [point.reported, point.resolved]));
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const step = plotWidth / Math.max(1, points.length);
  const y = (value: number) => PAD.top + plotHeight - (value / max) * plotHeight;
  const barWidth = Math.max(2, step * 0.6);

  const totalReported = points.reduce((sum, point) => sum + point.reported, 0);
  const totalResolved = points.reduce((sum, point) => sum + point.resolved, 0);
  const labelEvery = Math.ceil(points.length / 6);

  const resolvedPath = points
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'}${PAD.left + step * index + step / 2},${y(point.resolved)}`,
    )
    .join(' ');

  return (
    <figure>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        aria-hidden="true"
        preserveAspectRatio="none"
      >
        {[0, 0.5, 1].map((fraction) => (
          <g key={fraction}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(max * fraction)}
              y2={y(max * fraction)}
              className="stroke-border"
              strokeDasharray={fraction === 0 ? undefined : '3 3'}
            />
            <text
              x={PAD.left - 6}
              y={y(max * fraction) + 3}
              textAnchor="end"
              className="fill-ink-subtle text-[10px]"
            >
              {Math.round(max * fraction)}
            </text>
          </g>
        ))}
        {points.map((point, index) => (
          <rect
            key={point.date}
            x={PAD.left + step * index + (step - barWidth) / 2}
            y={y(point.reported)}
            width={barWidth}
            height={Math.max(0, PAD.top + plotHeight - y(point.reported))}
            rx={1.5}
            className="fill-primary/70"
          />
        ))}
        <path d={resolvedPath} fill="none" strokeWidth={1.5} className="stroke-success" />
        {points.map((point, index) =>
          point.resolved > 0 ? (
            <circle
              key={point.date}
              cx={PAD.left + step * index + step / 2}
              cy={y(point.resolved)}
              r={2.5}
              className="fill-success"
            />
          ) : null,
        )}
        {points.map((point, index) =>
          index % labelEvery === 0 ? (
            <text
              key={point.date}
              x={PAD.left + step * index + step / 2}
              y={HEIGHT - 6}
              textAnchor="middle"
              className="fill-ink-subtle text-[10px]"
            >
              {point.date.slice(5)}
            </text>
          ) : null,
        )}
      </svg>

      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 type-caption text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block size-2.5 rounded-[2px] bg-primary/70"
          />
          Reported ({formatNumber(totalReported)})
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block size-2.5 rounded-full bg-success"
          />
          Resolved ({formatNumber(totalResolved)})
        </span>
      </figcaption>

      <table className="sr-only">
        <caption>
          Reports and resolutions per day: {totalReported} reported and {totalResolved}{' '}
          resolved over {points.length} days.
        </caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Reported</th>
            <th scope="col">Resolved</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.date}>
              <th scope="row">{point.date}</th>
              <td>{point.reported}</td>
              <td>{point.resolved}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
