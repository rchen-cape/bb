A home for AI tooling in bb, in its own panel on the navigation rail. It starts with a token usage dashboard covering every thread, model, provider, and project.

## What you get

- A headline total for the last 7, 30, or 90 days, or for all time, with the change from the period before.
- Input, cache read, cache write, and output tokens as separate figures, plus the cache hit rate, turns, threads, and tokens reported by subagents.
- Usage over time as stacked daily bars, each with a table view of the same numbers.
- Usage by model, project, and provider, ranked, with each one's share and cache hit rate.
- The threads that used the most tokens. Open any of them for its usage turn by turn, including which model ran each turn.
- An activity heatmap by weekday and hour, in your time zone.
- Context make-up: what fills each thread's context window on average, such as the system prompt, tools, MCP tools, memory files, skills, and messages, and which ones cost the most.
- Filters by project and provider. The dashboard updates by itself as agents finish turns.

## How it works

bb keeps only the latest usage snapshot for each thread, so AI Hub keeps its own record. It saves each turn's usage as the turn finishes. Threads from before AI Hub was installed, and turns that finished while bb was not running, are counted from the snapshot bb kept. Those tokens are marked as estimated, and they are dated to that snapshot, not to the turns that used them. The dashboard shows when tracking began and what share of tokens is estimated. Claude Code and Pi restart their count with each provider session, so for older threads the estimate covers only the latest session. Pi also reports only the final model call of each turn.

Token counts come from the agent providers. Claude Code, Codex, and Pi report them, and ACP agents do not. Claude Code does not include subagent tokens in a turn's usage, so AI Hub shows them as a separate figure, without a split by token type. AI Hub shows tokens, not cost. For subscription limits, use the Provider usage plugin.

Everything in the panel is also available from the command line with `bb ai-hub`.
