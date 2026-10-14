---
name: ai-hub
description: Read token usage across BB threads, models, providers, and projects with `bb ai-hub`. Use when a request asks how many tokens were used, which threads, models, or projects used the most, cache hit rates, usage over time, or mentions AI Hub.
---

# AI Hub

AI Hub is the bb panel for AI tooling. Its first section is a token usage
dashboard, and every number in it is also available from `bb ai-hub`.

## How usage is recorded

bb keeps only the latest usage snapshot for each thread. AI Hub therefore
records each turn's usage in its own store as the turn finishes. Read the
numbers with these limits in mind:

- **Estimated tokens.** Two kinds of usage are known only from a later snapshot:
  - usage from before AI Hub was installed
  - usage from turns that finished while bb was not running

  These tokens are marked `backfill`. They are dated to the snapshot they were
  found in, not to the turns that used them. `coverage.backfilledTokens` gives
  their total for the range.

- **Undercounts.** Claude Code and Pi restart their count with each provider
  session, so threads older than AI Hub are estimated from their latest session
  only. Pi reports only the final model call of each turn.
- **Token types.** `inputTokens` is uncached input. Cache reads and cache
  writes are separate fields. `outputTokens` includes reasoning. `totalTokens`
  is the sum of input, cache read, cache write, and output.
- **Cache hit rate** is cache reads divided by all input:
  `cacheRead / (input + cacheRead + cacheWrite)`.
- **Subagent tokens.** These are tokens reported by Claude Code subagents. They
  have no split by token type and are not part of `totalTokens`.
- **No data.** ACP agents report no token usage, and AI Hub shows no cost.

## The `bb ai-hub` command

Every command accepts `--json`. `usage`, `usage threads`, `usage models`, and
`usage daily` also take these filters (`usage thread` does not):

- `--range 7d|30d|90d|all` (default `30d`)
- `--project <project-id>`
- `--provider <provider-id>`

Days are counted in the server's time zone.

| Command                               | Purpose                                                                                                    |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `bb ai-hub usage`                     | Totals, the change from the previous period, cache hit rate, top models and projects, and subagent tokens. |
| `bb ai-hub usage threads [--limit n]` | The threads that used the most tokens (default 10, at most 25).                                            |
| `bb ai-hub usage models`              | Usage by model.                                                                                            |
| `bb ai-hub usage daily`               | One line per day of the range, or per week for long all-time ranges.                                       |
| `bb ai-hub usage thread <thread-id>`  | One thread's usage, turn by turn, with the model of each turn and its subagent tasks.                      |
| `bb ai-hub status`                    | When tracking began, how many threads are indexed, and whether a scan is running.                          |
| `bb ai-hub rescan`                    | Queue a re-sync of every known thread. Recorded usage is never deleted or counted twice.                   |

For a question such as "how many tokens did this project use this week", run
`bb ai-hub usage --range 7d --project <id>`. Mention the estimated share when
it is large.
