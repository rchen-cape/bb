import type { ReactNode } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { formatPercent, type Delta } from "../format.js";

const SPARK_HEIGHT = 24;
const SPARK_INSET = 3;

export function Sparkline({
  values,
  color,
}: {
  values: readonly number[];
  color: string;
}) {
  if (values.length < 2) return <div aria-hidden className="h-6" />;
  const max = Math.max(...values);
  const span = SPARK_HEIGHT - SPARK_INSET * 2;
  const coordinates = values.map((value, index) => ({
    x: (index / (values.length - 1)) * 100,
    y: SPARK_HEIGHT - SPARK_INSET - (max > 0 ? (value / max) * span : 0),
  }));
  const last = coordinates[coordinates.length - 1];
  return (
    <div aria-hidden className="relative mr-1 h-6">
      <svg
        viewBox={`0 0 100 ${SPARK_HEIGHT}`}
        preserveAspectRatio="none"
        className="block h-full w-full overflow-visible"
      >
        <polyline
          points={coordinates.map(({ x, y }) => `${x},${y}`).join(" ")}
          fill="none"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          className="stroke-subtle-foreground/60"
        />
      </svg>
      {last !== undefined ? (
        <span
          className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
          style={{
            left: `${last.x}%`,
            top: `${(last.y / SPARK_HEIGHT) * 100}%`,
            backgroundColor: color,
          }}
        />
      ) : null}
    </div>
  );
}

export function Meter({
  label,
  ratio,
  fill,
  track,
}: {
  label: string;
  ratio: number | null;
  fill: string;
  track: string;
}) {
  const percent = ratio === null ? 0 : Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      aria-valuetext={formatPercent(ratio)}
      className="h-2 w-full overflow-hidden rounded-full"
      style={{ backgroundColor: track }}
    >
      <div
        className="h-full rounded-full"
        style={{ width: `${percent}%`, backgroundColor: fill }}
      />
    </div>
  );
}

function deltaSentence(delta: Delta, period: string): string {
  if (delta.direction === "flat") return `No change vs ${period}`;
  return `${delta.direction === "up" ? "Up" : "Down"} ${delta.text} vs ${period}`;
}

export function DeltaText({
  delta,
  period,
  compact = false,
  className,
}: {
  delta: Delta;
  period: string;
  compact?: boolean;
  className?: string;
}) {
  const sentence = deltaSentence(delta, period);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-muted-foreground",
        className,
      )}
    >
      {delta.direction === "flat" ? null : (
        <Icon
          name={delta.direction === "up" ? "ArrowUp" : "ArrowDown"}
          className="size-3.5 shrink-0"
          aria-hidden
        />
      )}
      {compact ? (
        <>
          <span aria-hidden>{delta.text}</span>
          <span className="sr-only">{sentence}</span>
        </>
      ) : (
        <span>{sentence}</span>
      )}
    </span>
  );
}

export function StatTile({
  label,
  value,
  detail,
  delta,
  period,
  children,
}: {
  label: string;
  value: string;
  detail?: ReactNode;
  delta?: Delta | null;
  period?: string | null;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border/60 bg-card p-3">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold text-foreground">{value}</p>
      {delta !== undefined &&
      delta !== null &&
      period !== undefined &&
      period !== null ? (
        <DeltaText delta={delta} period={period} compact className="text-xs" />
      ) : null}
      {detail !== undefined ? (
        <p className="text-xs text-subtle-foreground">{detail}</p>
      ) : null}
      {children !== undefined ? (
        <div className="mt-auto pt-1">{children}</div>
      ) : null}
    </div>
  );
}
