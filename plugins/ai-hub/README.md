# AI Hub

A nav panel for AI tooling in bb. Its first section is a token usage dashboard
covering every thread, model, provider, and project. The panel is a list of
sections (`views/shell.tsx`), so later tools such as a skills editor can be
added as new sections.

This is not the Provider usage plugin. Provider usage shows subscription and
quota windows. AI Hub counts the tokens agents used.

## Features

- **Totals:** for 7, 30, or 90 days, or for all time, with the change from the
  previous period of the same length.
- **Token types:** input, cache read, cache write, and output, plus cache hit
  rate, turns, and threads.
- **Charts:** usage over time as stacked bars, and rankings by model, project,
  and provider. Each chart has a table view.
- **Top threads:** each one opens a per-turn view with the model that ran each
  turn.
- **Activity heatmap:** usage by weekday and hour in the viewer's time zone.
- **Context make-up:** the average make-up of each thread's latest Claude Code
  context snapshot: system prompt, tools, MCP tools, memory files, skills, and
  messages. Deferred tools, which are not loaded, are listed separately.
- **Live updates:** the panel refreshes over realtime as turns finish.
- **CLI:** `bb ai-hub usage|usage threads|usage models|usage daily|usage
thread|status|rescan`.

## How usage is recorded

bb prunes `thread/tokenUsage/updated` events. Only the latest root snapshot of
each thread survives, and Claude Code and Pi reset their running `total`
whenever the provider session restarts. AI Hub therefore keeps its own ledger
in the plugin's SQLite database:

- **Recording:** each usage event becomes a ledger entry. Entries are keyed by
  event id, so a re-sync never counts the same usage twice.
- **Claude Code and Pi:** the entry is the event's `last` breakdown. If the
  `total` grew by more than that, the difference is recorded as a separate
  `backfill` entry. This happens when turns were pruned before AI Hub saw
  them, or when a thread is older than AI Hub.
- **Codex:** Codex reports a cumulative `total` for the thread, so AI Hub
  records the change in `total`:
  - The part up to the event's `last` is a live entry. Anything beyond it came
    from calls AI Hub missed and is recorded as `backfill`.
  - Repeated totals are skipped, and a drop in `total` counts as a reset.
  - A forked or rewound Codex thread starts from the source thread's total,
    and a resumed Codex subagent can carry its earlier total under a new
    stream. On the first event of such a stream, only `last` is recorded:
    inherited usage cannot be told apart from missed calls, so neither is
    counted again.
- **Subagent turns:** each one gets its own stream, keyed by the
  `parentToolCallId` from its `turn/started` event.
- **Models:** each turn's model comes from its `client/turn/requested` event.
  A `provider/modelFallback` event overrides it.
- **Subagent tasks:** tokens from `item/backgroundTask/completed` events are
  stored separately, because Claude Code reports them without a split by
  token type.
- **Triggers:** the indexer syncs a thread on `experimental_thread.events` and
  `thread.idle`. It reconciles every thread at startup and every 10 minutes.

Tokens are normalized to one convention across providers:

- `inputTokens` is uncached input.
- `cacheReadTokens` and `cacheWriteTokens` are separate fields.
- `outputTokens` includes reasoning.

## Limits

- **Estimated usage:** usage from before AI Hub was installed, or from while bb
  was not running, comes from a later snapshot. It is dated to that snapshot,
  not to the turns that used it, and is labelled as estimated.
- **Older provider sessions:** Claude Code and Pi reset `total` when a provider
  session restarts. For threads older than AI Hub, the estimate covers only
  their most recent session, and earlier sessions are not counted.
- **Pi:** Pi reports only the final model call of each turn, so Pi turns are
  undercounted.
- **Legacy cache counts:** bb versions before mid-September 2026 reported cache
  reads and writes as one number. AI Hub counts that number as cache reads,
  which makes cache hit rates for that older usage slightly high.
- **ACP agents** report no token usage.
- **No cost:** AI Hub shows no cost, because the providers do not report it.
- **Deleted threads** keep their recorded usage.
