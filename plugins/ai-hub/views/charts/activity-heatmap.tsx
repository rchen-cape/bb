import { useMemo, useState, type KeyboardEvent } from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import type { ActivityCell } from "../../src/contract.js";
import {
  WEEKDAY_SHORT,
  formatHourRange,
  formatInteger,
  pluralize,
} from "../format.js";
import { ChartTooltip } from "./chart-card.js";
import { WEEKDAY_ORDER, buildActivityMatrix, hourBlockFor } from "./heatmap.js";
import { sequentialColor, type ChartPalette } from "./palette.js";
import { useElementWidth } from "./use-element-width.js";

const LABEL_WIDTH = 32;
const CELL_GAP = 2;
const CELL_HEIGHT = 24;
const HEADER_HEIGHT = 16;
const FALLBACK_WIDTH = 640;

export function ActivityHeatmap({
  cells,
  palette,
}: {
  cells: readonly ActivityCell[];
  palette: ChartPalette;
}) {
  const { ref, width } = useElementWidth<HTMLDivElement>(FALLBACK_WIDTH);
  const blockHours = hourBlockFor({
    width,
    labelWidth: LABEL_WIDTH + CELL_GAP,
    gap: CELL_GAP,
    minCell: 24,
  });
  const matrix = useMemo(
    () => buildActivityMatrix(cells, blockHours),
    [cells, blockHours],
  );
  const [active, setActive] = useState<{ row: number; column: number } | null>(
    null,
  );
  const cellWidth =
    (width - LABEL_WIDTH - CELL_GAP * matrix.columns) / matrix.columns;
  const headerEvery = Math.max(1, 6 / blockHours);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = active ?? { row: 0, column: 0 };
    const moves: Record<string, { row: number; column: number }> = {
      ArrowRight: { row: current.row, column: current.column + 1 },
      ArrowLeft: { row: current.row, column: current.column - 1 },
      ArrowDown: { row: current.row + 1, column: current.column },
      ArrowUp: { row: current.row - 1, column: current.column },
    };
    if (event.key === "Escape") {
      setActive(null);
      event.preventDefault();
      return;
    }
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setActive(
      active === null
        ? current
        : {
            row: Math.max(0, Math.min(6, next.row)),
            column: Math.max(0, Math.min(matrix.columns - 1, next.column)),
          },
    );
  };

  const activeWeekday = active === null ? undefined : WEEKDAY_ORDER[active.row];
  const activeTokens =
    active === null || activeWeekday === undefined
      ? 0
      : (matrix.tokens[activeWeekday]?.[active.column] ?? 0);
  const activeTurns =
    active === null || activeWeekday === undefined
      ? 0
      : (matrix.turns[activeWeekday]?.[active.column] ?? 0);
  const activeTitle =
    active === null || activeWeekday === undefined
      ? ""
      : `${WEEKDAY_SHORT[activeWeekday]} ${formatHourRange(active.column * blockHours, blockHours)}`;

  return (
    <div ref={ref} className="relative min-w-0">
      <div
        role="group"
        tabIndex={0}
        aria-label="Activity by weekday and hour. Use the arrow keys to read each cell."
        className="rounded-sm focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
      >
        <div
          aria-hidden
          className="grid"
          style={{
            gridTemplateColumns: `${LABEL_WIDTH}px repeat(${matrix.columns}, minmax(0, 1fr))`,
            gap: CELL_GAP,
          }}
        >
          <span />
          {Array.from({ length: matrix.columns }, (_, column) => (
            <span
              key={column}
              className="text-2xs leading-4 text-subtle-foreground tabular-nums"
              style={{ height: HEADER_HEIGHT }}
            >
              {column % headerEvery === 0
                ? String(column * blockHours).padStart(2, "0")
                : ""}
            </span>
          ))}
          {WEEKDAY_ORDER.map((weekday, row) => (
            <HeatmapRow
              key={weekday}
              label={WEEKDAY_SHORT[weekday]}
              values={matrix.tokens[weekday] ?? []}
              max={matrix.max}
              palette={palette}
              activeColumn={active?.row === row ? active.column : null}
              onHover={(column) => setActive({ row, column })}
            />
          ))}
        </div>
      </div>
      {active !== null ? (
        <ChartTooltip
          title={activeTitle}
          width={width}
          anchorX={
            LABEL_WIDTH +
            CELL_GAP +
            active.column * (cellWidth + CELL_GAP) +
            cellWidth / 2
          }
          anchorY={
            HEADER_HEIGHT +
            CELL_GAP +
            (active.row + 1) * (CELL_HEIGHT + CELL_GAP)
          }
          rows={[
            {
              id: "tokens",
              label: "tokens",
              value: formatInteger(activeTokens),
              color:
                sequentialColor(palette, activeTokens, matrix.max) ??
                palette.neutral,
            },
          ]}
          note={pluralize(activeTurns, "turn")}
        />
      ) : null}
      <p className="sr-only" aria-live="polite">
        {active === null
          ? ""
          : `${activeTitle}: ${formatInteger(activeTokens)} tokens, ${pluralize(activeTurns, "turn")}`}
      </p>
      <div
        aria-hidden
        className="mt-2 flex items-center justify-end gap-1 text-2xs text-subtle-foreground"
      >
        <span className="mr-1">Less</span>
        {palette.sequential.map((color) => (
          <span
            key={color}
            className="size-2.5 rounded-xs"
            style={{ backgroundColor: color }}
          />
        ))}
        <span className="ml-1">More</span>
      </div>
    </div>
  );
}

function HeatmapRow({
  label,
  values,
  max,
  palette,
  activeColumn,
  onHover,
}: {
  label: string;
  values: readonly number[];
  max: number;
  palette: ChartPalette;
  activeColumn: number | null;
  onHover: (column: number) => void;
}) {
  return (
    <>
      <span className="self-center text-2xs text-subtle-foreground">
        {label}
      </span>
      {values.map((value, column) => {
        const color = sequentialColor(palette, value, max);
        return (
          <span
            key={column}
            onPointerEnter={() => onHover(column)}
            className={cn(
              "rounded-xs",
              color === null && "bg-surface-recessed",
              activeColumn === column &&
                "outline-1 outline-offset-1 outline-foreground/70 outline-solid",
            )}
            style={{
              height: CELL_HEIGHT,
              backgroundColor: color ?? undefined,
            }}
          />
        );
      })}
    </>
  );
}
