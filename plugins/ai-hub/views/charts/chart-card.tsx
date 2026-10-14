import { useId, useState, type ReactNode } from "react";
import { ToggleGroup, ToggleGroupItem } from "@bb/shared-ui/toggle-group";
import { cn } from "@bb/shared-ui/lib/utils";

export type ChartView = "chart" | "table";

export const SEGMENT_GROUP_CLASS =
  "gap-0.5 rounded-md bg-surface-recessed p-0.5";
export const SEGMENT_ITEM_CLASS =
  "h-6 min-w-0 px-2 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs";

export function useChartView() {
  return useState<ChartView>("chart");
}

export function ViewToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ChartView;
  onChange: (next: ChartView) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      size="sm"
      value={value}
      aria-label={`${label} view`}
      className={SEGMENT_GROUP_CLASS}
      onValueChange={(next) => {
        if (next === "chart" || next === "table") onChange(next);
      }}
    >
      <ToggleGroupItem value="chart" className={SEGMENT_ITEM_CLASS}>
        Chart
      </ToggleGroupItem>
      <ToggleGroupItem value="table" className={SEGMENT_ITEM_CLASS}>
        Table
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

export function ChartCard({
  title,
  description,
  view,
  onViewChange,
  legend,
  className,
  children,
}: {
  title: string;
  description?: ReactNode;
  view?: ChartView;
  onViewChange?: (next: ChartView) => void;
  legend?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "min-w-0 rounded-lg border border-border/60 bg-card p-3",
        className,
      )}
    >
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 id={headingId} className="text-sm font-medium text-foreground">
            {title}
          </h3>
          {description !== undefined ? (
            <p className="mt-0.5 text-xs text-subtle-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {view !== undefined && onViewChange !== undefined ? (
          <ViewToggle label={title} value={view} onChange={onViewChange} />
        ) : null}
      </div>
      {legend !== undefined ? <div className="mt-2">{legend}</div> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export interface LegendItem {
  id: string;
  label: string;
  color: string;
  estimated?: boolean;
}

export function Legend({ items }: { items: readonly LegendItem[] }) {
  return (
    <ul
      aria-label="Legend"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
    >
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-xs"
            style={{
              backgroundColor: item.color,
              opacity: item.estimated === true ? ESTIMATED_OPACITY : 1,
            }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

export const ESTIMATED_OPACITY = 0.4;

export interface TableColumn<Row> {
  id: string;
  header: string;
  align?: "left" | "right";
  className?: string;
  cell: (row: Row) => ReactNode;
}

export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
}: {
  caption: string;
  columns: readonly TableColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
}) {
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-subtle-foreground">
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                className={cn(
                  "px-2 py-1.5 font-medium whitespace-nowrap first:pl-0 last:pr-0",
                  column.align === "right" ? "text-right" : "text-left",
                  column.className,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-t border-border/60">
              {columns.map((column) => (
                <td
                  key={column.id}
                  className={cn(
                    "px-2 py-1.5 whitespace-nowrap text-foreground first:pl-0 last:pr-0",
                    column.align === "right"
                      ? "text-right tabular-nums"
                      : "text-left",
                    column.className,
                  )}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface TooltipRow {
  id: string;
  label: string;
  value: string;
  color: string;
}

export function ChartTooltip({
  title,
  rows,
  footer,
  note,
  anchorX,
  anchorY,
  width,
}: {
  title: string;
  rows: readonly TooltipRow[];
  footer?: { label: string; value: string };
  note?: string;
  anchorX: number;
  anchorY: number;
  width: number;
}) {
  const placeLeft = anchorX > width / 2;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-10 min-w-36 rounded-md border border-border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-md"
      style={
        placeLeft
          ? { right: Math.max(0, width - anchorX + 10), top: anchorY }
          : { left: Math.max(0, anchorX + 10), top: anchorY }
      }
    >
      <p className="mb-1 font-medium text-foreground">{title}</p>
      <ul className="space-y-0.5">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-2">
            <span
              className="h-0.5 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: row.color }}
            />
            <span className="font-medium text-foreground tabular-nums">
              {row.value}
            </span>
            <span className="text-muted-foreground">{row.label}</span>
          </li>
        ))}
      </ul>
      {footer !== undefined ? (
        <p className="mt-1 flex items-center gap-2 border-t border-border/60 pt-1">
          <span className="w-3 shrink-0" />
          <span className="font-medium text-foreground tabular-nums">
            {footer.value}
          </span>
          <span className="text-muted-foreground">{footer.label}</span>
        </p>
      ) : null}
      {note !== undefined ? (
        <p className="mt-1 text-subtle-foreground">{note}</p>
      ) : null}
    </div>
  );
}
