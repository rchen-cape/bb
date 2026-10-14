import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatCompact, formatInteger } from "../format.js";
import { ChartTooltip, ESTIMATED_OPACITY } from "./chart-card.js";
import {
  bandLayout,
  niceTicks,
  roundedTopRectPath,
  stackSegments,
  sum,
  thinTickIndices,
} from "./scale.js";
import { useElementWidth } from "./use-element-width.js";

export interface ColumnSeries {
  id: string;
  label: string;
  color: string;
}

export interface ColumnPoint {
  id: string;
  title: string;
  tick: string;
  values: readonly number[];
  total: number;
  estimated: boolean;
}

const MARGIN = { top: 8, right: 4, bottom: 22, left: 40 };
const SEGMENT_GAP = 2;
const BAR_RADIUS = 4;
const MIN_TICK_SPACING = 64;
const FALLBACK_WIDTH = 640;

export function StackedColumnChart({
  label,
  series,
  points,
  height = 200,
  estimatedNote,
}: {
  label: string;
  series: readonly ColumnSeries[];
  points: readonly ColumnPoint[];
  height?: number;
  estimatedNote?: string;
}) {
  const { ref, width } = useElementWidth<HTMLDivElement>(FALLBACK_WIDTH);
  const [active, setActive] = useState<number | null>(null);
  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const plotHeight = Math.max(0, height - MARGIN.top - MARGIN.bottom);
  const ticks = niceTicks(Math.max(0, ...points.map((p) => sum(p.values))));
  const top = ticks[ticks.length - 1] ?? 0;
  const unitPx = top > 0 ? plotHeight / top : 0;
  const layout = bandLayout({ count: points.length, width: plotWidth });
  const labelled = thinTickIndices(points.length, plotWidth / MIN_TICK_SPACING);
  const activeIndex = active !== null && active < points.length ? active : null;
  const activePoint = activeIndex === null ? undefined : points[activeIndex];

  const moveTo = (next: number) => {
    if (points.length === 0) return;
    setActive(Math.max(0, Math.min(points.length - 1, next)));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = activeIndex ?? points.length;
    if (event.key === "ArrowRight")
      moveTo(activeIndex === null ? 0 : current + 1);
    else if (event.key === "ArrowLeft") moveTo(current - 1);
    else if (event.key === "Home") moveTo(0);
    else if (event.key === "End") moveTo(points.length - 1);
    else if (event.key === "Escape") setActive(null);
    else return;
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (points.length === 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    setActive(layout.indexAt(event.clientX - bounds.left - MARGIN.left));
  };

  if (points.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-subtle-foreground">
        Nothing recorded in this range.
      </p>
    );
  }

  return (
    <div ref={ref} className="relative min-w-0 overflow-hidden">
      <div
        role="group"
        tabIndex={0}
        aria-label={`${label}. Use the arrow keys to read each bar.`}
        className="rounded-sm focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
      >
        <svg
          aria-hidden
          width={width}
          height={height}
          className="block touch-pan-y"
          onPointerMove={onPointerMove}
          onPointerDown={onPointerMove}
          onPointerLeave={() => setActive(null)}
        >
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            {ticks.map((tick) => {
              const y = Math.round(plotHeight - tick * unitPx) + 0.5;
              return (
                <g key={tick}>
                  <line
                    x1={0}
                    x2={plotWidth}
                    y1={y}
                    y2={y}
                    strokeWidth={1}
                    className={
                      tick === 0 ? "stroke-border" : "stroke-border-hairline"
                    }
                  />
                  <text
                    x={-6}
                    y={y}
                    dy="0.32em"
                    textAnchor="end"
                    className="fill-subtle-foreground text-2xs tabular-nums"
                  >
                    {formatCompact(tick)}
                  </text>
                </g>
              );
            })}
            {activeIndex !== null ? (
              <rect
                x={activeIndex * layout.step}
                y={0}
                width={layout.step}
                height={plotHeight}
                className="fill-state-hover"
              />
            ) : null}
            {points.map((point, index) => {
              const segments = stackSegments(point.values, unitPx, SEGMENT_GAP);
              const x = layout.barX(index);
              return (
                <g
                  key={point.id}
                  opacity={point.estimated ? ESTIMATED_OPACITY : 1}
                >
                  {segments.map((segment, position) => {
                    if (segment.size < 0.5) return null;
                    const color = series[segment.seriesIndex]?.color;
                    const y = plotHeight - segment.start - segment.size;
                    return position === segments.length - 1 ? (
                      <path
                        key={segment.seriesIndex}
                        d={roundedTopRectPath({
                          x,
                          y,
                          width: layout.barWidth,
                          height: segment.size,
                          radius: BAR_RADIUS,
                        })}
                        style={{ fill: color }}
                      />
                    ) : (
                      <rect
                        key={segment.seriesIndex}
                        x={x}
                        y={y}
                        width={layout.barWidth}
                        height={segment.size}
                        style={{ fill: color }}
                      />
                    );
                  })}
                </g>
              );
            })}
            {labelled.map((index) => (
              <text
                key={index}
                x={layout.center(index)}
                y={plotHeight + 15}
                textAnchor="middle"
                className="fill-subtle-foreground text-2xs"
              >
                {points[index]?.tick}
              </text>
            ))}
          </g>
        </svg>
      </div>
      {activePoint !== undefined && activeIndex !== null ? (
        <ChartTooltip
          title={activePoint.title}
          width={width}
          anchorX={MARGIN.left + layout.center(activeIndex)}
          anchorY={MARGIN.top}
          rows={series.map((entry, seriesIndex) => ({
            id: entry.id,
            label: entry.label,
            color: entry.color,
            value: formatInteger(activePoint.values[seriesIndex] ?? 0),
          }))}
          footer={{ label: "Total", value: formatInteger(activePoint.total) }}
          note={activePoint.estimated ? estimatedNote : undefined}
        />
      ) : null}
      <p className="sr-only" aria-live="polite">
        {activePoint === undefined
          ? ""
          : `${activePoint.title}: ${formatInteger(activePoint.total)} tokens`}
      </p>
    </div>
  );
}
