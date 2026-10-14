import type { ContextSummary } from "../../src/contract.js";
import {
  ChartCard,
  DataTable,
  useChartView,
  type TableColumn,
} from "../charts/chart-card.js";
import { categoricalColor, type ChartPalette } from "../charts/palette.js";
import { sum } from "../charts/scale.js";
import {
  formatCompact,
  formatInteger,
  formatPercent,
  pluralize,
  shareOf,
} from "../format.js";

const TOP_ENTRY_LIMIT = 8;

type ContextCategory = ContextSummary["categories"][number];
type ContextEntry = ContextSummary["topEntries"][number];

interface CategoryItem {
  id: string;
  label: string;
  averageTokens: number;
  color: string;
}

const DEFERRED_SUFFIX = /\s*\(deferred\)$/i;

function categoryItems(
  categories: readonly ContextCategory[],
  palette: ChartPalette,
): CategoryItem[] {
  const used = categories.filter(
    (category) => category.kind === "used" && category.averageTokens > 0,
  );
  const slotCount = palette.categorical.length;
  const fits = used.length <= slotCount;
  const head = fits ? used : used.slice(0, slotCount - 1);
  const items = head.map((category, index) => ({
    id: `${category.kind}:${category.label}`,
    label: category.label,
    averageTokens: category.averageTokens,
    color: categoricalColor(palette, index),
  }));
  if (!fits) {
    const rest = used.slice(slotCount - 1);
    items.push({
      id: "other",
      label: `Other (${rest.length})`,
      averageTokens: sum(rest.map((category) => category.averageTokens)),
      color: palette.neutral,
    });
  }
  return items;
}

function DeferredLine({
  categories,
}: {
  categories: readonly ContextCategory[];
}) {
  const deferred = categories.filter(
    (category) => category.kind === "deferred" && category.averageTokens > 0,
  );
  if (deferred.length === 0) return null;
  const parts = deferred.map(
    (category) =>
      `${category.label.replace(DEFERRED_SUFFIX, "")} ${formatCompact(category.averageTokens)}`,
  );
  return (
    <p className="mt-2 text-xs text-subtle-foreground">
      {`Deferred, not loaded: ${parts.join(" · ")}`}
    </p>
  );
}

export function ContextCard({
  context,
  palette,
}: {
  context: ContextSummary;
  palette: ChartPalette;
}) {
  const [view, setView] = useChartView();
  const items = categoryItems(context.categories, palette);
  const used = sum(items.map((item) => item.averageTokens));
  const windowTokens = context.averageWindowTokens;
  const scale =
    windowTokens !== null && windowTokens >= used ? windowTokens : used;
  const entries = [...context.topEntries]
    .sort((a, b) => b.averageTokens - a.averageTokens)
    .slice(0, TOP_ENTRY_LIMIT);
  const entryMax = Math.max(0, ...entries.map((entry) => entry.averageTokens));

  const categoryColumns: TableColumn<CategoryItem>[] = [
    { id: "category", header: "Category", cell: (item) => item.label },
    {
      id: "tokens",
      header: "Avg tokens",
      align: "right",
      cell: (item) => formatInteger(item.averageTokens),
    },
    {
      id: "share",
      header: windowTokens === null ? "Share" : "Of window",
      align: "right",
      cell: (item) => formatPercent(shareOf(item.averageTokens, scale)),
    },
  ];
  const entryColumns: TableColumn<ContextEntry>[] = [
    { id: "entry", header: "Entry", cell: (entry) => entry.label },
    { id: "category", header: "Category", cell: (entry) => entry.category },
    {
      id: "tokens",
      header: "Avg tokens",
      align: "right",
      cell: (entry) => formatInteger(entry.averageTokens),
    },
    {
      id: "threads",
      header: "Threads",
      align: "right",
      cell: (entry) => formatInteger(entry.threads),
    },
  ];

  return (
    <ChartCard
      title="Context overhead"
      description={`Average across the latest context snapshot of ${pluralize(context.threads, "thread")}`}
      view={view}
      onViewChange={setView}
    >
      <p className="mb-2 text-xs text-muted-foreground">
        {formatCompact(context.averageUsedTokens)} tokens in context on average
        {windowTokens === null
          ? ""
          : ` of a ${formatCompact(windowTokens)} window`}
      </p>
      {view === "chart" ? (
        <div className="space-y-4">
          <div>
            <div aria-hidden className="flex h-3 w-full gap-0.5">
              {items.map((item, index) => (
                <div
                  key={item.id}
                  className="h-full min-w-px"
                  style={{
                    flexGrow: item.averageTokens,
                    flexBasis: 0,
                    backgroundColor: item.color,
                    borderRadius:
                      index === items.length - 1 && scale === used
                        ? "0 4px 4px 0"
                        : undefined,
                  }}
                />
              ))}
              {scale > used ? (
                <div
                  className="h-full bg-surface-recessed"
                  style={{
                    flexGrow: scale - used,
                    flexBasis: 0,
                    borderRadius: "0 4px 4px 0",
                  }}
                />
              ) : null}
            </div>
            <ul className="mt-3 grid gap-x-4 gap-y-1 @xl:grid-cols-2">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex min-h-6 items-center gap-2 text-xs"
                >
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-xs"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {item.label}
                  </span>
                  <span className="font-medium text-foreground tabular-nums">
                    {formatCompact(item.averageTokens)}
                  </span>
                  <span className="w-10 text-right text-subtle-foreground tabular-nums">
                    {formatPercent(shareOf(item.averageTokens, scale))}
                  </span>
                </li>
              ))}
            </ul>
            <DeferredLine categories={context.categories} />
          </div>
          {entries.length > 0 ? (
            <div>
              <h4 className="mb-2 text-xs font-medium text-muted-foreground">
                Largest entries
              </h4>
              <ul className="space-y-2">
                {entries.map((entry) => (
                  <li
                    key={`${entry.category}:${entry.label}`}
                    className="min-w-0"
                  >
                    <div className="flex min-h-6 items-center gap-2 text-xs">
                      <span
                        className="min-w-0 flex-1 truncate text-foreground"
                        title={entry.label}
                      >
                        {entry.label}
                      </span>
                      <span className="shrink-0 text-subtle-foreground">
                        {entry.category}
                      </span>
                      <span className="w-12 text-right font-medium text-foreground tabular-nums">
                        {formatCompact(entry.averageTokens)}
                      </span>
                    </div>
                    <div aria-hidden className="h-1.5">
                      <div
                        className="h-full"
                        style={{
                          width: `${Math.max(0.5, (shareOf(entry.averageTokens, entryMax) ?? 0) * 100)}%`,
                          backgroundColor: palette.accent,
                          borderRadius: "0 4px 4px 0",
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <DataTable
              caption="Average context by category"
              columns={categoryColumns}
              rows={items}
              rowKey={(item) => item.id}
            />
            <DeferredLine categories={context.categories} />
          </div>
          {entries.length > 0 ? (
            <DataTable
              caption="Largest context entries"
              columns={entryColumns}
              rows={entries}
              rowKey={(entry) => `${entry.category}:${entry.label}`}
            />
          ) : null}
        </div>
      )}
    </ChartCard>
  );
}
