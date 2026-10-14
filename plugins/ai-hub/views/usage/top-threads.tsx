import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import type { ThreadUsageRow } from "../../src/contract.js";
import {
  ChartCard,
  DataTable,
  type TableColumn,
} from "../charts/chart-card.js";
import {
  cacheHitRate,
  formatCompact,
  formatPercent,
  formatRelativeTime,
} from "../format.js";

export function threadDisplayTitle(row: Pick<ThreadUsageRow, "title">) {
  const title = row.title.trim();
  return title.length > 0 ? title : "Untitled thread";
}

export function TopThreads({
  rows,
  timeZone,
  nowMs,
  onOpenUsage,
  onOpenThread,
}: {
  rows: readonly ThreadUsageRow[];
  timeZone: string;
  nowMs: number;
  onOpenUsage: (threadId: string) => void;
  onOpenThread: (threadId: string) => void;
}) {
  const columns: TableColumn<ThreadUsageRow>[] = [
    {
      id: "thread",
      header: "Thread",
      cell: (row) => (
        <div className="flex max-w-72 min-w-0 items-center gap-1.5">
          <button
            type="button"
            className="min-w-0 cursor-pointer truncate rounded-sm text-left font-medium text-foreground hover:underline focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
            onClick={() => onOpenUsage(row.threadId)}
          >
            {threadDisplayTitle(row)}
          </button>
          {row.deleted ? (
            <Badge
              variant="outline"
              className="shrink-0 px-1.5 py-0 text-2xs font-normal text-muted-foreground"
            >
              Deleted
            </Badge>
          ) : null}
          {row.hasBackfill ? (
            <span className="shrink-0 text-2xs text-subtle-foreground">
              est.
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: "project",
      header: "Project",
      className: "hidden @2xl:table-cell",
      cell: (row) => (
        <span className="text-muted-foreground">
          {row.projectName ?? "No project"}
        </span>
      ),
    },
    {
      id: "model",
      header: "Model",
      className: "hidden @lg:table-cell",
      cell: (row) => (
        <span className="text-muted-foreground">{row.model ?? "Unknown"}</span>
      ),
    },
    {
      id: "total",
      header: "Total",
      align: "right",
      cell: (row) => (
        <span className="font-medium">{formatCompact(row.totalTokens)}</span>
      ),
    },
    {
      id: "io",
      header: "In / out",
      align: "right",
      className: "hidden @xl:table-cell",
      cell: (row) =>
        `${formatCompact(row.inputTokens)} / ${formatCompact(row.outputTokens)}`,
    },
    {
      id: "cache",
      header: "Cache hit",
      align: "right",
      className: "hidden @3xl:table-cell",
      cell: (row) => formatPercent(cacheHitRate(row)),
    },
    {
      id: "active",
      header: "Last active",
      align: "right",
      className: "hidden @md:table-cell",
      cell: (row) => (
        <span className="text-muted-foreground">
          {formatRelativeTime({
            timestamp: row.lastActivityMs,
            now: nowMs,
            timeZone,
          })}
        </span>
      ),
    },
    {
      id: "open",
      header: "",
      align: "right",
      cell: (row) => (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-7"
          aria-label={`Open thread ${threadDisplayTitle(row)}`}
          disabled={row.deleted}
          onClick={() => onOpenThread(row.threadId)}
        >
          <Icon name="ArrowUpRight" aria-hidden />
        </Button>
      ),
    },
  ];

  return (
    <ChartCard
      title="Top threads"
      description="Ranked by tokens in this range. Pick a thread to see each turn."
    >
      {rows.length === 0 ? (
        <p className="py-4 text-center text-xs text-subtle-foreground">
          No threads used tokens in this range.
        </p>
      ) : (
        <DataTable
          caption="Top threads"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.threadId}
        />
      )}
    </ChartCard>
  );
}
