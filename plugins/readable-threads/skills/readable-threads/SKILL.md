---
name: readable-threads
description: "How the Readable threads plugin styles thread chats (bold, italics, code, key-text highlights, Todo: items) and how to change its settings. Use when thread styling looks wrong, a highlight is missing, or the user wants to tune colors or keywords."
---

# Readable threads

The plugin restyles chat messages in the open thread. It changes how text
looks, never the text itself.

## What it styles

| Layer               | What changes                                                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Message styling     | Bold and italic colors, headings, quotes, list markers, inline code tints, a colored edge on code blocks by language, message accents, the "New" divider. |
| Key-text highlights | In agent replies: `Todo:` in the Notes link blue, `Note:`, errors (red), warnings (amber), file paths, numbers with units, issue refs, extra keywords.    |
| Agent hints         | Agents are told to start action items with `**Todo:**`, bold the main conclusion, mark warnings and notes, and tag code blocks.                           |

Highlights cover only agent replies, and only messages near the screen. Text
inside code blocks and links is not highlighted. Inline code is tinted as a
path or a command when it looks like one.

## Settings

Change them in Settings → Installed plugins → Readable threads, or with the CLI:

```bash
bb plugin config readable-threads set styling false
bb plugin config readable-threads set intensity bold
bb plugin config readable-threads set keywordHighlights true
bb plugin config readable-threads set customKeywords "rollback, migration"
bb plugin config readable-threads set agentHints false
```

Agent hints apply to new agent turns. Styling changes apply right away.

## Troubleshooting

- No highlights at all: the window's browser engine lacks the CSS Custom
  Highlight API, or `keywordHighlights` is off.
- `Todo:` is colored but not bold: the agent wrote it without `**`. Agent
  hints ask for the bold form.
- Styling stopped after a bb update: the plugin targets bb's chat markup
  (`[data-message-column]`, `pre.bb-code-highlight`). If bb renames them, the
  plugin does nothing rather than breaking the chat.
