import { useId, type ReactNode } from "react";
import {
  experimental_ProviderIcon as ProviderIcon,
  experimental_useProviders,
} from "@get-bb/plugin-sdk/app";
import type { BreakdownRow, UsageReport } from "../../src/contract.js";
import {
  ChartCard,
  DataTable,
  ViewToggle,
  useChartView,
  type ChartView,
  type TableColumn,
} from "../charts/chart-card.js";
import { assignSlots, foldRows } from "../charts/fold.js";
import { categoricalColor, type ChartPalette } from "../charts/palette.js";
import { sum } from "../charts/scale.js";
import {
  cacheHitRate,
  formatCompact,
  formatInteger,
  formatPercent,
  pluralize,
  shareOf,
} from "../format.js";

const FOLD_LIMIT = 7;

interface BreakdownItem {
  id: string;
  label: string;
  color: string;
  icon: ReactNode;
  row: BreakdownRow;
  isOther: boolean;
}

export function Breakdowns({
  report,
  palette,
}: {
  report: UsageReport;
  palette: ChartPalette;
}) {
  const headingId = useId();
  const [view, setView] = useChartView();
  const { providers } = experimental_useProviders();
  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <div className="flex items-center gap-2">
        <h3
          id={headingId}
          className="min-w-0 flex-1 text-sm font-medium text-foreground"
        >
          Breakdown
        </h3>
        <ViewToggle label="Breakdown" value={view} onChange={setView} />
      </div>
      <div className="grid gap-3 @3xl:grid-cols-3">
        <BreakdownCard
          title="By model"
          rows={report.byModel}
          stableOrder={[]}
          view={view}
          palette={palette}
        />
        <BreakdownCard
          title="By project"
          rows={report.byProject}
          stableOrder={report.options.projects.map((option) => option.id)}
          view={view}
          palette={palette}
        />
        <BreakdownCard
          title="By provider"
          rows={report.byProvider}
          stableOrder={report.options.providers.map((option) => option.id)}
          view={view}
          palette={palette}
          resolveLabel={(row) =>
            providers.find((provider) => provider.id === row.key)
              ?.displayName ?? row.label
          }
          renderIcon={(row) => {
            if (row.key === null) return null;
            const key = row.key;
            const info = providers.find((provider) => provider.id === key);
            return (
              <ProviderIcon
                providerKind="agent"
                provider={info ?? { id: key }}
                fallback="Bot"
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-hidden
              />
            );
          }}
        />
      </div>
    </section>
  );
}

function BreakdownCard({
  title,
  rows,
  stableOrder,
  view,
  palette,
  resolveLabel,
  renderIcon,
}: {
  title: string;
  rows: readonly BreakdownRow[];
  stableOrder: readonly string[];
  view: ChartView;
  palette: ChartPalette;
  resolveLabel?: (row: BreakdownRow) => string;
  renderIcon?: (row: BreakdownRow) => ReactNode;
}) {
  const total = sum(rows.map((row) => row.totalTokens));
  const folded = foldRows(rows, FOLD_LIMIT);
  const slots = assignSlots({
    keys: folded.visible.map((row) => row.key),
    stableOrder,
    slotCount: palette.categorical.length,
  });
  const items: BreakdownItem[] = folded.visible.map((row) => ({
    id: row.key ?? `none:${row.label}`,
    label: resolveLabel?.(row) ?? row.label,
    color:
      row.key === null
        ? palette.neutral
        : categoricalColor(palette, slots.get(row.key)),
    icon: renderIcon?.(row) ?? null,
    row,
    isOther: false,
  }));
  if (folded.other !== null) {
    items.push({
      id: "other",
      label: folded.other.label,
      color: palette.neutral,
      icon: null,
      row: folded.other,
      isOther: true,
    });
  }
  const columns: TableColumn<BreakdownItem>[] = [
    { id: "name", header: "Name", cell: (item) => item.label },
    {
      id: "tokens",
      header: "Tokens",
      align: "right",
      cell: (item) => formatInteger(item.row.totalTokens),
    },
    {
      id: "share",
      header: "Share",
      align: "right",
      cell: (item) => formatPercent(shareOf(item.row.totalTokens, total)),
    },
    {
      id: "turns",
      header: "Turns",
      align: "right",
      cell: (item) => formatInteger(item.row.turns),
    },
    {
      id: "cache",
      header: "Cache hit",
      align: "right",
      cell: (item) => formatPercent(cacheHitRate(item.row)),
    },
    {
      id: "threads",
      header: "Threads",
      align: "right",
      cell: (item) => (item.isOther ? "—" : formatInteger(item.row.threads)),
    },
  ];

  return (
    <ChartCard title={title}>
      {items.length === 0 ? (
        <p className="py-4 text-center text-xs text-subtle-foreground">
          No usage in this range.
        </p>
      ) : view === "chart" ? (
        <ul className="space-y-2.5">
          {items.map((item) => (
            <BreakdownBar key={item.id} item={item} total={total} />
          ))}
        </ul>
      ) : (
        <DataTable
          caption={title}
          columns={columns}
          rows={items}
          rowKey={(item) => item.id}
        />
      )}
    </ChartCard>
  );
}

function BreakdownBar({ item, total }: { item: BreakdownItem; total: number }) {
  const share = shareOf(item.row.totalTokens, total) ?? 0;
  return (
    <li className="min-w-0">
      <div className="flex min-h-6 items-center gap-2 text-xs">
        {item.icon}
        <span
          className="min-w-0 flex-1 truncate text-foreground"
          title={item.label}
        >
          {item.label}
        </span>
        <span className="font-medium text-foreground tabular-nums">
          {formatCompact(item.row.totalTokens)}
        </span>
        <span className="w-10 text-right text-subtle-foreground tabular-nums">
          {formatPercent(share)}
        </span>
      </div>
      <div aria-hidden className="h-2">
        <div
          className="h-full"
          style={{
            width: `${Math.max(0.5, share * 100)}%`,
            backgroundColor: item.color,
            borderRadius: "0 4px 4px 0",
          }}
        />
      </div>
      <p className="mt-1 text-xs text-subtle-foreground">
        {pluralize(item.row.turns, "turn")} ·{" "}
        {formatPercent(cacheHitRate(item.row))} cache hit
      </p>
    </li>
  );
}
