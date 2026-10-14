import {
  PluginCliError,
  cliCommand,
  defineCli,
  type PluginCliRegistration,
  type PluginCliResult,
} from "@get-bb/plugin-sdk";
import {
  RANGE_PRESETS,
  type Coverage,
  type RangePreset,
  type ThreadDetail,
  type TokenTotals,
  type UsageEntry,
  type UsageReport,
} from "./contract.js";
import type { UsageApi } from "./report.js";
import {
  createZonedClock,
  dateKey,
  formatLocalDateTime,
  RANGE_DAYS,
  type ZonedClock,
} from "./time.js";

export const AI_HUB_CLI_NAME = "ai-hub";
export const DEFAULT_THREAD_LIMIT = 10;
export const MAX_THREAD_LIMIT = 25;
export const MAX_JSON_THREAD_ENTRIES = 2_000;
export const MAX_TEXT_TURNS = 500;
const MAX_TEXT_TASKS = 200;
const SUMMARY_TOP_ROWS = 5;
const MAX_TITLE_LENGTH = 60;

const JSON_OPTION = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;

const FILTER_OPTIONS = {
  range: {
    type: "enum",
    values: RANGE_PRESETS,
    default: "30d",
    description:
      "Time range: 7d, 30d, 90d, or all; days are counted in the server's time zone",
  },
  project: {
    type: "string",
    placeholder: "project-id",
    description: "Only count usage from threads in this project",
  },
  provider: {
    type: "string",
    placeholder: "provider-id",
    description:
      "Only count usage from threads run by this provider, such as claude-code or codex",
  },
  json: JSON_OPTION,
} as const;

const COMPACT_UNITS = [
  ["K", 1e3],
  ["M", 1e6],
  ["B", 1e9],
  ["T", 1e12],
] as const;

export function formatCompact(value: number): string {
  const rounded = Math.round(value);
  const magnitude = Math.abs(rounded);
  if (magnitude < 1_000) return String(rounded);
  const sign = rounded < 0 ? "-" : "";
  for (const [index, [suffix, size]] of COMPACT_UNITS.entries()) {
    const scaled = Math.round((magnitude / size) * 10) / 10;
    if (scaled < 1_000 || index === COMPACT_UNITS.length - 1) {
      return `${sign}${scaled.toFixed(1)}${suffix}`;
    }
  }
  return String(rounded);
}

export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

export function cacheHitRate(totals: TokenTotals): number | null {
  const prompt =
    totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
  return prompt === 0 ? null : totals.cacheReadTokens / prompt;
}

function formatHitRate(totals: TokenTotals): string {
  const rate = cacheHitRate(totals);
  return rate === null ? "-" : formatPercent(rate);
}

function formatChange(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? "no change" : "new";
  const change = (current - previous) / previous;
  return `${change >= 0 ? "+" : ""}${formatPercent(change)}`;
}

function formatShare(part: number, whole: number): string {
  return whole === 0 ? "-" : formatPercent(part / whole);
}

function formatDuration(durationMs: number): string {
  const seconds = Math.round(durationMs / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)
    return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function truncate(text: string, length: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length <= length ? line : `${line.slice(0, length - 3)}...`;
}

type Align = "left" | "right";

function renderTable(
  columns: readonly { header: string; align: Align }[],
  rows: readonly string[][],
): string[] {
  const widths = columns.map((column, index) =>
    rows.reduce(
      (widest, row) => Math.max(widest, (row[index] ?? "").length),
      column.header.length,
    ),
  );
  const line = (cells: readonly string[]) =>
    columns
      .map((column, index) => {
        const cell = cells[index] ?? "";
        const width = widths[index] ?? cell.length;
        return column.align === "right"
          ? cell.padStart(width)
          : cell.padEnd(width);
      })
      .join("  ")
      .trimEnd();
  return [line(columns.map((column) => column.header)), ...rows.map(line)];
}

function renderPairs(
  rows: readonly (readonly [string, string, string?])[],
  align: Align = "right",
) {
  return renderTable(
    [
      { header: "", align: "left" },
      { header: "", align },
      { header: "", align: "left" },
    ],
    rows.map(([label, value, note]) => [label, value, note ?? ""]),
  ).slice(1);
}

function rangeName(range: RangePreset): string {
  return range === "all" ? "all time" : `last ${RANGE_DAYS[range]} days`;
}

function rangeSpan(report: UsageReport, clock: ZonedClock): string {
  const today = dateKey(clock.parts(report.generatedAtMs));
  const first =
    report.range.startMs === null
      ? (report.timeline[0]?.label ?? null)
      : dateKey(clock.parts(report.range.startMs));
  return first === null ? today : `${first} to ${today}`;
}

function heading(title: string, report: UsageReport, clock: ZonedClock) {
  const lines = [
    `${title}, ${rangeName(report.filters.range)} (${rangeSpan(report, clock)}, ${report.filters.timeZone})`,
  ];
  const filters: string[] = [];
  if (report.filters.projectId !== null) {
    const project = report.options.projects.find(
      (option) => option.id === report.filters.projectId,
    );
    filters.push(`project ${project?.label ?? report.filters.projectId}`);
  }
  if (report.filters.providerId !== null) {
    const provider = report.options.providers.find(
      (option) => option.id === report.filters.providerId,
    );
    filters.push(`provider ${provider?.label ?? report.filters.providerId}`);
  }
  if (filters.length > 0) lines.push(`Filtered to ${filters.join(", ")}`);
  return lines;
}

function coverageNote(
  coverage: Coverage,
  totalTokens: number,
  clock: ZonedClock,
): string[] {
  const lines: string[] = [];
  const since =
    coverage.trackingSinceMs === null
      ? "Tracking has not started yet."
      : `Tracking since ${formatLocalDateTime(clock, coverage.trackingSinceMs)}.`;
  const estimated =
    coverage.backfilledTokens > 0
      ? ` ${formatShare(coverage.backfilledTokens, totalTokens)} of these tokens are estimated from snapshots bb kept.`
      : "";
  lines.push(`${since}${estimated}`);
  if (coverage.scanning) {
    lines.push(
      `Indexing ${coverage.pendingThreads} threads; the numbers may still grow.`,
    );
  }
  return lines;
}

export function renderUsageSummary(report: UsageReport, clock: ZonedClock) {
  const lines = heading("Token usage", report, clock);
  lines.push("");
  const { totals } = report;
  if (totals.totalTokens === 0 && report.subagents.tasks === 0) {
    lines.push("No token usage recorded in this range.", "");
    lines.push(...coverageNote(report.coverage, totals.totalTokens, clock));
    return `${lines.join("\n")}\n`;
  }
  const { range } = report.filters;
  const change =
    report.previousTotals === null || range === "all"
      ? undefined
      : `${formatChange(totals.totalTokens, report.previousTotals.totalTokens)} vs previous ${RANGE_DAYS[range]} days`;
  lines.push(
    ...renderPairs([
      ["Total tokens", formatCompact(totals.totalTokens), change],
      ["Input", formatCompact(totals.inputTokens)],
      ["Cache read", formatCompact(totals.cacheReadTokens)],
      ["Cache write", formatCompact(totals.cacheWriteTokens)],
      ["Output", formatCompact(totals.outputTokens)],
      ["Reasoning", formatCompact(totals.reasoningTokens), "part of output"],
      ["Cache hit rate", formatHitRate(totals)],
      ["Turns", String(totals.turns)],
      ["Threads", String(totals.threads)],
      [
        "Subagent tasks",
        String(report.subagents.tasks),
        report.subagents.tasks === 0
          ? undefined
          : `${formatCompact(report.subagents.totalTokens)} tokens, reported separately`,
      ],
    ]),
  );
  const sections = [
    ["Top models", report.byModel],
    ["Top projects", report.byProject],
  ] as const;
  for (const [title, rows] of sections) {
    if (rows.length === 0) continue;
    lines.push("", title);
    const table = renderTable(
      [
        { header: "NAME", align: "left" },
        { header: "TOKENS", align: "right" },
        { header: "SHARE", align: "right" },
      ],
      rows
        .slice(0, SUMMARY_TOP_ROWS)
        .map((row) => [
          row.label,
          formatCompact(row.totalTokens),
          formatShare(row.totalTokens, totals.totalTokens),
        ]),
    );
    lines.push(...table.slice(1).map((line) => `  ${line}`));
  }
  lines.push("", ...coverageNote(report.coverage, totals.totalTokens, clock));
  return `${lines.join("\n")}\n`;
}

export function renderTopThreads(
  report: UsageReport,
  clock: ZonedClock,
  limit: number,
) {
  const lines = heading("Top threads", report, clock);
  lines.push("");
  const rows = report.topThreads.slice(0, limit);
  if (rows.length === 0) {
    lines.push("No token usage recorded in this range.");
    return `${lines.join("\n")}\n`;
  }
  const anyBackfill = rows.some((row) => row.hasBackfill);
  lines.push(
    ...renderTable(
      [
        { header: "TOKENS", align: "right" },
        { header: "TURNS", align: "right" },
        { header: "HIT RATE", align: "right" },
        { header: "MODEL", align: "left" },
        { header: "PROJECT", align: "left" },
        { header: "LAST ACTIVE", align: "left" },
        { header: "THREAD", align: "left" },
        { header: "TITLE", align: "left" },
      ],
      rows.map((row) => [
        `${formatCompact(row.totalTokens)}${row.hasBackfill ? "*" : anyBackfill ? " " : ""}`,
        String(row.turns),
        formatHitRate(row),
        row.model ?? "-",
        row.projectName ?? row.projectId ?? "-",
        formatLocalDateTime(clock, row.lastActivityMs),
        row.threadId,
        `${truncate(row.title, MAX_TITLE_LENGTH)}${row.deleted ? " (deleted)" : ""}`,
      ]),
    ),
  );
  if (anyBackfill) {
    lines.push("", "* includes tokens estimated from snapshots bb kept");
  }
  return `${lines.join("\n")}\n`;
}

export function renderModels(report: UsageReport, clock: ZonedClock) {
  const lines = heading("Token usage by model", report, clock);
  lines.push("");
  if (report.byModel.length === 0) {
    lines.push("No token usage recorded in this range.");
    return `${lines.join("\n")}\n`;
  }
  lines.push(
    ...renderTable(
      [
        { header: "MODEL", align: "left" },
        { header: "TOTAL", align: "right" },
        { header: "SHARE", align: "right" },
        { header: "INPUT", align: "right" },
        { header: "CACHE READ", align: "right" },
        { header: "CACHE WRITE", align: "right" },
        { header: "OUTPUT", align: "right" },
        { header: "HIT RATE", align: "right" },
        { header: "TURNS", align: "right" },
        { header: "THREADS", align: "right" },
      ],
      report.byModel.map((row) => [
        row.label,
        formatCompact(row.totalTokens),
        formatShare(row.totalTokens, report.totals.totalTokens),
        formatCompact(row.inputTokens),
        formatCompact(row.cacheReadTokens),
        formatCompact(row.cacheWriteTokens),
        formatCompact(row.outputTokens),
        formatHitRate(row),
        String(row.turns),
        String(row.threads),
      ]),
    ),
  );
  return `${lines.join("\n")}\n`;
}

export function renderDaily(report: UsageReport, clock: ZonedClock) {
  const lines = heading(
    report.range.bucket === "week" ? "Weekly token usage" : "Daily token usage",
    report,
    clock,
  );
  lines.push("");
  if (report.timeline.length === 0) {
    lines.push("No token usage recorded yet.");
    return `${lines.join("\n")}\n`;
  }
  lines.push(
    ...renderTable(
      [
        {
          header: report.range.bucket === "week" ? "WEEK OF" : "DATE",
          align: "left",
        },
        { header: "TOTAL", align: "right" },
        { header: "INPUT", align: "right" },
        { header: "CACHE READ", align: "right" },
        { header: "CACHE WRITE", align: "right" },
        { header: "OUTPUT", align: "right" },
        { header: "TURNS", align: "right" },
      ],
      report.timeline.map((point) => [
        point.label,
        formatCompact(point.totalTokens),
        formatCompact(point.inputTokens),
        formatCompact(point.cacheReadTokens),
        formatCompact(point.cacheWriteTokens),
        formatCompact(point.outputTokens),
        String(point.turns),
      ]),
    ),
  );
  return `${lines.join("\n")}\n`;
}

interface TurnLine {
  createdAtMs: number;
  model: string | null;
  kind: string;
  totals: TokenTotals;
}

function turnLines(entries: readonly UsageEntry[]): TurnLine[] {
  const lines = new Map<string, TurnLine>();
  for (const entry of entries) {
    const key = [entry.turnId ?? entry.id, entry.source, entry.isSubagent].join(
      "\u001f",
    );
    const line = lines.get(key) ?? {
      createdAtMs: entry.createdAtMs,
      model: entry.model,
      kind:
        entry.source === "backfill"
          ? "estimated"
          : entry.isSubagent
            ? "subagent"
            : "turn",
      totals: {
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        turns: 0,
      },
    };
    line.totals.inputTokens += entry.inputTokens;
    line.totals.cacheReadTokens += entry.cacheReadTokens;
    line.totals.cacheWriteTokens += entry.cacheWriteTokens;
    line.totals.outputTokens += entry.outputTokens;
    line.totals.reasoningTokens += entry.reasoningTokens;
    line.totals.totalTokens += entry.totalTokens;
    lines.set(key, line);
  }
  return [...lines.values()];
}

export function renderThreadDetail(detail: ThreadDetail, clock: ZonedClock) {
  const { thread } = detail;
  const lines = [
    `${truncate(thread.title, 120)} (${thread.threadId})${thread.deleted ? " (deleted)" : ""}`,
    [
      `Project ${thread.projectName ?? thread.projectId ?? "-"}`,
      `provider ${thread.providerId}`,
      `model ${thread.model ?? "-"}`,
      `last active ${formatLocalDateTime(clock, thread.lastActivityMs)}`,
    ].join(", "),
    "",
    ...renderPairs([
      ["Total tokens", formatCompact(thread.totalTokens)],
      ["Input", formatCompact(thread.inputTokens)],
      ["Cache read", formatCompact(thread.cacheReadTokens)],
      ["Cache write", formatCompact(thread.cacheWriteTokens)],
      ["Output", formatCompact(thread.outputTokens)],
      ["Cache hit rate", formatHitRate(thread)],
      ["Turns", String(thread.turns)],
    ]),
  ];
  const turns = turnLines(detail.entries);
  if (turns.length > 0) {
    const shown = turns.slice(-MAX_TEXT_TURNS);
    lines.push("");
    if (shown.length < turns.length) {
      lines.push(
        `Showing the latest ${shown.length} of ${turns.length} turns; use --json for more.`,
      );
    }
    lines.push(
      ...renderTable(
        [
          { header: "TIME", align: "left" },
          { header: "KIND", align: "left" },
          { header: "MODEL", align: "left" },
          { header: "INPUT", align: "right" },
          { header: "CACHE READ", align: "right" },
          { header: "CACHE WRITE", align: "right" },
          { header: "OUTPUT", align: "right" },
          { header: "TOTAL", align: "right" },
        ],
        shown.map((line) => [
          formatLocalDateTime(clock, line.createdAtMs),
          line.kind,
          line.model ?? "-",
          formatCompact(line.totals.inputTokens),
          formatCompact(line.totals.cacheReadTokens),
          formatCompact(line.totals.cacheWriteTokens),
          formatCompact(line.totals.outputTokens),
          formatCompact(line.totals.totalTokens),
        ]),
      ),
    );
  }
  if (detail.subagentTasks.length > 0) {
    const tasks = detail.subagentTasks.slice(-MAX_TEXT_TASKS);
    const tokens = detail.subagentTasks.reduce(
      (sum, task) => sum + task.totalTokens,
      0,
    );
    lines.push(
      "",
      `Subagent tasks: ${detail.subagentTasks.length}, ${formatCompact(tokens)} tokens, reported separately`,
      ...renderTable(
        [
          { header: "TIME", align: "left" },
          { header: "TOKENS", align: "right" },
          { header: "TOOL USES", align: "right" },
          { header: "DURATION", align: "right" },
          { header: "ITEM", align: "left" },
        ],
        tasks.map((task) => [
          formatLocalDateTime(clock, task.createdAtMs),
          formatCompact(task.totalTokens),
          String(task.toolUses),
          formatDuration(task.durationMs),
          task.itemId,
        ]),
      ),
    );
  }
  if (thread.hasBackfill) {
    lines.push(
      "",
      "Estimated rows are tokens bb's latest snapshot counted that no recorded turn accounts for.",
    );
  }
  return `${lines.join("\n")}\n`;
}

export function renderStatus(coverage: Coverage, clock: ZonedClock) {
  const time = (ms: number | null) =>
    ms === null ? "never" : formatLocalDateTime(clock, ms);
  return `${renderPairs(
    [
      ["Tracking since", time(coverage.trackingSinceMs)],
      ["Last indexed", time(coverage.lastIndexedAtMs)],
      ["Indexed threads", String(coverage.indexedThreads)],
      ["Pending threads", String(coverage.pendingThreads)],
      ["Scanning", coverage.scanning ? "yes" : "no"],
      ["Estimated tokens", formatCompact(coverage.backfilledTokens)],
    ],
    "left",
  ).join("\n")}\n`;
}

function json(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

async function attempt(
  work: () => Promise<PluginCliResult>,
): Promise<PluginCliResult> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof PluginCliError) throw error;
    throw new PluginCliError(
      error instanceof Error ? error.message : String(error),
      { code: "ai_hub_failed" },
    );
  }
}

export function createAiHubCli(deps: {
  api: UsageApi;
  timeZone: () => string;
}): PluginCliRegistration {
  function context() {
    const timeZone = deps.timeZone();
    return { timeZone, clock: createZonedClock(timeZone) };
  }

  async function loadReport(options: {
    range: RangePreset;
    project: string | undefined;
    provider: string | undefined;
  }) {
    const { timeZone, clock } = context();
    const report = await deps.api.report({
      range: options.range,
      projectId: options.project ?? null,
      providerId: options.provider ?? null,
      timeZone,
    });
    return { report, clock };
  }

  return defineCli({
    name: AI_HUB_CLI_NAME,
    summary:
      "Read token usage across bb threads, models, providers, and projects",
    description:
      "AI Hub records each turn's token usage as it finishes. Usage from before tracking began, or from turns bb pruned before AI Hub saw them, is estimated from the latest snapshot bb kept and marked as estimated. Cache hit rate is cache reads / (input + cache reads + cache writes). Subagent tasks are reported separately and are not part of the totals.",
    commands: {
      usage: cliCommand({
        summary:
          "Show totals, the change from the previous period, cache hit rate, and the top models and projects",
        options: FILTER_OPTIONS,
        run: ({ options }) =>
          attempt(async () => {
            const { report, clock } = await loadReport(options);
            return {
              exitCode: 0,
              stdout: options.json
                ? json(report)
                : renderUsageSummary(report, clock),
            };
          }),
      }),
      "usage threads": cliCommand({
        summary: "List the threads that used the most tokens",
        options: {
          ...FILTER_OPTIONS,
          limit: {
            type: "integer",
            min: 1,
            max: MAX_THREAD_LIMIT,
            default: DEFAULT_THREAD_LIMIT,
            description: `How many threads to list (at most ${MAX_THREAD_LIMIT})`,
          },
        },
        run: ({ options }) =>
          attempt(async () => {
            const { report, clock } = await loadReport(options);
            return {
              exitCode: 0,
              stdout: options.json
                ? json({
                    filters: report.filters,
                    range: report.range,
                    threads: report.topThreads.slice(0, options.limit),
                  })
                : renderTopThreads(report, clock, options.limit),
            };
          }),
      }),
      "usage models": cliCommand({
        summary: "Break token usage down by model",
        options: FILTER_OPTIONS,
        run: ({ options }) =>
          attempt(async () => {
            const { report, clock } = await loadReport(options);
            return {
              exitCode: 0,
              stdout: options.json
                ? json({
                    filters: report.filters,
                    range: report.range,
                    models: report.byModel,
                  })
                : renderModels(report, clock),
            };
          }),
      }),
      "usage daily": cliCommand({
        summary:
          "Show token usage per day, or per week for all-time ranges longer than 120 days",
        options: FILTER_OPTIONS,
        run: ({ options }) =>
          attempt(async () => {
            const { report, clock } = await loadReport(options);
            return {
              exitCode: 0,
              stdout: options.json
                ? json({
                    filters: report.filters,
                    range: report.range,
                    timeline: report.timeline,
                  })
                : renderDaily(report, clock),
            };
          }),
      }),
      "usage thread": cliCommand({
        summary:
          "Show one thread's token usage turn by turn, with the model of each turn",
        positionals: [
          {
            name: "thread-id",
            description: "Thread id, as listed by `bb ai-hub usage threads`",
            required: true,
          },
        ],
        options: { json: JSON_OPTION },
        run: ({ options, positionals }) =>
          attempt(async () => {
            const threadId = positionals["thread-id"];
            const detail = await deps.api.threadUsage(threadId);
            if (detail === null) {
              throw new PluginCliError(
                `AI Hub has no usage recorded for thread ${threadId}.`,
                {
                  code: "not_found",
                  hint: "Run `bb ai-hub usage threads` to list threads with recorded usage.",
                },
              );
            }
            if (options.json) {
              return {
                exitCode: 0,
                stdout: json({
                  ...detail,
                  entries: detail.entries.slice(-MAX_JSON_THREAD_ENTRIES),
                }),
                ...(detail.entries.length > MAX_JSON_THREAD_ENTRIES
                  ? {
                      stderr: `Showing the latest ${MAX_JSON_THREAD_ENTRIES} of ${detail.entries.length} entries.\n`,
                    }
                  : {}),
              };
            }
            return {
              exitCode: 0,
              stdout: renderThreadDetail(detail, context().clock),
            };
          }),
      }),
      status: cliCommand({
        summary: "Show when tracking began and how far indexing has got",
        options: { json: JSON_OPTION },
        run: ({ options }) =>
          attempt(async () => {
            const coverage = deps.api.status();
            return {
              exitCode: 0,
              stdout: options.json
                ? json(coverage)
                : renderStatus(coverage, context().clock),
            };
          }),
      }),
      rescan: cliCommand({
        summary:
          "Queue a re-sync of every known thread; recorded usage is never deleted or counted twice",
        options: { json: JSON_OPTION },
        run: ({ options }) =>
          attempt(async () => {
            const { queuedThreads } = deps.api.rescan();
            return {
              exitCode: 0,
              stdout: options.json
                ? json({ queuedThreads })
                : `Queued ${queuedThreads} threads for a re-sync.\n`,
            };
          }),
      }),
    },
  });
}
