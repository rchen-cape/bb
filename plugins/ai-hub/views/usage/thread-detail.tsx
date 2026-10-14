import { useState } from "react";
import {
  experimental_useProviders,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import type {
  SubagentTask,
  ThreadDetail,
  UsageEntry,
} from "../../src/contract.js";
import {
  ChartCard,
  DataTable,
  Legend,
  type TableColumn,
} from "../charts/chart-card.js";
import { Meter, StatTile } from "../charts/figures.js";
import {
  TOKEN_TYPES,
  TOKEN_TYPE_LABELS,
  useChartPalette,
} from "../charts/palette.js";
import { sum } from "../charts/scale.js";
import { StackedColumnChart } from "../charts/stacked-columns.js";
import {
  cacheHitRate,
  formatCompact,
  formatDateTime,
  formatDay,
  formatDuration,
  formatInteger,
  formatPercent,
  formatRelativeTime,
  formatTime,
  pluralize,
  shortId,
} from "../format.js";
import { ErrorRow, LoadingLine, NotFound } from "../states.js";
import { useAiHubQuery } from "../use-ai-hub-query.js";
import { threadDisplayTitle } from "./top-threads.js";

const SAME_DAY_SPAN_MS = 36 * 60 * 60 * 1000;
const ESTIMATED_NOTE = "Estimated: found in a later snapshot";

export function ThreadUsageView({
  threadId,
  timeZone,
  onBack,
}: {
  threadId: string;
  timeZone: string;
  onBack: () => void;
}) {
  const query = useAiHubQuery(`thread:${threadId}`, (rpc) =>
    rpc.call("threadUsage", { threadId }),
  );
  const detail = query.data;

  if (detail === null) {
    if (query.error !== null) {
      return (
        <div className="mx-auto w-full max-w-6xl space-y-4 p-4 md:p-5">
          <BackButton onBack={onBack} />
          <ErrorRow
            message={`Couldn't load thread usage: ${query.error}`}
            onRetry={query.refresh}
          />
        </div>
      );
    }
    if (query.loading) return <LoadingLine>Loading thread usage…</LoadingLine>;
    return (
      <NotFound
        title="No usage for this thread"
        message="AI Hub has no recorded usage for this thread. It may not have finished a turn yet, or its provider does not report tokens."
        backLabel="Back to Usage"
        onBack={onBack}
      />
    );
  }

  return (
    <div
      aria-busy={query.loading}
      className={cn(
        "@container mx-auto w-full max-w-6xl space-y-4 p-4 transition-opacity duration-200 md:p-5",
        query.loading && "opacity-60",
      )}
    >
      <BackButton onBack={onBack} />
      {query.error !== null ? (
        <ErrorRow
          message={`Couldn't refresh thread usage: ${query.error}`}
          onRetry={query.refresh}
        />
      ) : null}
      <ThreadDetailBody detail={detail} timeZone={timeZone} />
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="-ml-2 h-7 px-2 text-xs"
      onClick={onBack}
    >
      <Icon name="ArrowLeft" aria-hidden />
      Usage
    </Button>
  );
}

function ThreadDetailBody({
  detail,
  timeZone,
}: {
  detail: ThreadDetail;
  timeZone: string;
}) {
  const navigate = useBbNavigate();
  const palette = useChartPalette();
  const { providers } = experimental_useProviders();
  const { thread, subagentTasks } = detail;
  const entries = [...detail.entries].sort(
    (a, b) => a.createdAtMs - b.createdAtMs,
  );
  const first = entries[0];
  const last = entries[entries.length - 1];
  const shortSpan =
    first !== undefined &&
    last !== undefined &&
    last.createdAtMs - first.createdAtMs < SAME_DAY_SPAN_MS;
  const [nowMs] = useState(() => Date.now());
  const providerName =
    providers.find((provider) => provider.id === thread.providerId)
      ?.displayName ?? thread.providerId;
  const hitRate = cacheHitRate(thread);
  const subagentTokens = sum(subagentTasks.map((task) => task.totalTokens));
  const series = TOKEN_TYPES.map((type) => ({
    id: type,
    label: TOKEN_TYPE_LABELS[type],
    color: palette.tokens[type],
  }));
  const hasEstimated = entries.some((entry) => entry.source === "backfill");
  const title = threadDisplayTitle(thread);

  const entryColumns: TableColumn<UsageEntry>[] = [
    {
      id: "time",
      header: "Time",
      cell: (entry) => formatDateTime(entry.createdAtMs, timeZone),
    },
    {
      id: "turn",
      header: "Turn",
      cell: (entry) =>
        entry.turnId === null ? (
          <span className="text-subtle-foreground">—</span>
        ) : (
          <span className="font-mono" title={entry.turnId}>
            {shortId(entry.turnId)}
          </span>
        ),
    },
    {
      id: "model",
      header: "Model",
      cell: (entry) => entry.model ?? "Unknown",
    },
    {
      id: "source",
      header: "Source",
      cell: (entry) =>
        `${entry.source === "backfill" ? "Estimated" : "Live"}${entry.isSubagent ? " · subagent" : ""}`,
    },
    ...TOKEN_TYPES.map((type): TableColumn<UsageEntry> => ({
      id: type,
      header: TOKEN_TYPE_LABELS[type],
      align: "right",
      cell: (entry) => formatInteger(entry[type]),
    })),
    {
      id: "total",
      header: "Total",
      align: "right",
      cell: (entry) => (
        <span className="font-medium">{formatInteger(entry.totalTokens)}</span>
      ),
    },
  ];
  const taskColumns: TableColumn<SubagentTask>[] = [
    {
      id: "time",
      header: "Time",
      cell: (task) => formatDateTime(task.createdAtMs, timeZone),
    },
    {
      id: "turn",
      header: "Turn",
      cell: (task) =>
        task.turnId === null ? (
          "—"
        ) : (
          <span className="font-mono" title={task.turnId}>
            {shortId(task.turnId)}
          </span>
        ),
    },
    {
      id: "tokens",
      header: "Tokens",
      align: "right",
      cell: (task) => formatInteger(task.totalTokens),
    },
    {
      id: "tools",
      header: "Tool uses",
      align: "right",
      cell: (task) => formatInteger(task.toolUses),
    },
    {
      id: "duration",
      header: "Duration",
      align: "right",
      cell: (task) => formatDuration(task.durationMs),
    },
  ];

  return (
    <>
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold text-foreground">
            <span className="truncate">{title}</span>
            {thread.deleted ? (
              <Badge
                variant="outline"
                className="shrink-0 px-1.5 py-0 text-2xs font-normal text-muted-foreground"
              >
                Deleted
              </Badge>
            ) : null}
          </h2>
          <p className="text-xs text-muted-foreground">
            {[
              thread.projectName ?? "No project",
              thread.model ?? "Unknown model",
              providerName,
              `last active ${formatRelativeTime({ timestamp: thread.lastActivityMs, now: nowMs, timeZone })}`,
            ].join(" · ")}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={thread.deleted}
          onClick={() => navigate.toThread(thread.threadId)}
        >
          <Icon name="ArrowUpRight" aria-hidden />
          Open thread
        </Button>
      </header>

      <div className="grid grid-cols-2 gap-2 @xl:grid-cols-4">
        <StatTile
          label="Total tokens"
          value={formatCompact(thread.totalTokens)}
          detail={formatInteger(thread.totalTokens)}
        />
        {TOKEN_TYPES.map((type) => (
          <StatTile
            key={type}
            label={TOKEN_TYPE_LABELS[type]}
            value={formatCompact(thread[type])}
            detail={
              type === "outputTokens" && thread.reasoningTokens > 0
                ? `${formatCompact(thread.reasoningTokens)} reasoning`
                : undefined
            }
          />
        ))}
        <StatTile label="Cache hit rate" value={formatPercent(hitRate)}>
          <Meter
            label="Cache hit rate"
            ratio={hitRate}
            fill={palette.accent}
            track={palette.meterTrack}
          />
        </StatTile>
        <StatTile label="Turns" value={formatCompact(thread.turns)} />
        <StatTile
          label="Subagent tokens"
          value={formatCompact(subagentTokens)}
          detail={`Reported by subagents; not split by type · ${pluralize(subagentTasks.length, "task")}`}
        />
      </div>

      <ChartCard
        title="Usage by entry"
        description={`${pluralize(entries.length, "entry", "entries")}, oldest first`}
        legend={
          <Legend
            items={[
              ...series,
              ...(hasEstimated
                ? [
                    {
                      id: "estimated",
                      label: "Estimated",
                      color: palette.neutral,
                      estimated: true,
                    },
                  ]
                : []),
            ]}
          />
        }
      >
        <StackedColumnChart
          label="Usage by entry"
          series={series}
          estimatedNote={ESTIMATED_NOTE}
          points={entries.map((entry) => ({
            id: entry.id,
            title: formatDateTime(entry.createdAtMs, timeZone),
            tick: shortSpan
              ? formatTime(entry.createdAtMs, timeZone)
              : formatDay(entry.createdAtMs, timeZone),
            values: TOKEN_TYPES.map((type) => entry[type]),
            total: entry.totalTokens,
            estimated: entry.source === "backfill",
          }))}
        />
      </ChartCard>

      <ChartCard
        title="Entries"
        description={
          hasEstimated
            ? "Estimated entries were found in a later snapshot, not seen as the turn finished."
            : undefined
        }
      >
        {entries.length === 0 ? (
          <p className="py-4 text-center text-xs text-subtle-foreground">
            No entries recorded.
          </p>
        ) : (
          <DataTable
            caption="Usage entries"
            columns={entryColumns}
            rows={[...entries].reverse()}
            rowKey={(entry) => entry.id}
          />
        )}
      </ChartCard>

      {subagentTasks.length > 0 ? (
        <ChartCard
          title="Subagent tasks"
          description={`Tokens reported by subagents, ${formatCompact(subagentTokens)} in total. Not split by type.`}
        >
          <DataTable
            caption="Subagent tasks"
            columns={taskColumns}
            rows={subagentTasks}
            rowKey={(task) => task.itemId}
          />
        </ChartCard>
      ) : null}
    </>
  );
}
