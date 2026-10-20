---
name: notes
description: Read and edit the Markdown notes shown in BB's Notes panel. Use when a request mentions the Notes panel, `bb notes`, the notes folder, a note by filename, or the Markdown highlight rules, table of contents, and `@` Wiki doc completion that panel applies.
---

# Notes

Notes is a live-preview Markdown editor over one folder on the primary machine,
`~/Notes` by default. Text looks rendered while you write: headings are sized,
emphasis is styled, lists show bullets and checkboxes, and tables render as
tables. A construct's Markdown marks appear only while the cursor touches it,
and the file stays plain Markdown: saving changes only what the user edited and
keeps the byte-order mark and line ending. A file with mixed line endings is
saved with the ending most of its lines use. YAML frontmatter collapses to a
"Properties" line until the cursor enters it.

Editing helpers in the panel:

- Selecting text shows a formatting toolbar: Highlight, Bold, Italic,
  Strikethrough, Code, Link. The shortcuts are ⌘⇧H, ⌘B, ⌘I, ⌘⇧S, ⌘E and ⌘K
  (Ctrl on Linux and Windows).
- `==text==` is a highlight. Write it that way when an agent edits a note and
  should highlight something.
- Typing `/` on an empty line opens a block menu: Text, Heading 1–3, Bulleted
  list, Numbered list, To-do list, Quote, Code block, Divider, Table.
- ⌘F opens find and replace. ⌘D selects the next match. A selected match inside
  hidden Markdown, such as collapsed frontmatter, is shown.
- Tab indents list items and code and accepts an open completion; elsewhere it
  does nothing. ⌘⇧K deletes the line and ⌘Enter opens a new line below.
- Clicking a rendered link opens web links through bb, and a relative link to
  another note (`[Plan](plan.md)`) opens that note in the panel. A link to
  `#anchor` (as in a table of contents) scrolls to that heading. When a link
  cannot be opened (unknown note, missing heading, `mailto:`), the click puts
  the cursor in the link instead.
- Reload (after a conflict, or from the toolbar) replaces the note with the disk
  version and starts a new undo history.
- Fenced code blocks are coloured from the active bb code theme for common
  languages (shell, JS/TS, JSON, Python, Go, YAML, SQL, Rust, and others).

Notes is deliberately narrow:

- Only Markdown files (`.md`, `.markdown`, `.mdx`, `.mdown`, `.mkd`) appear in
  the tree and can be opened or written. Other files on disk are left alone.
- Dotfiles and dot-directories are hidden, so the panel never shows its own
  `.vscode/settings.json`.
- Every path is resolved inside the notes folder; `..` and absolute paths are
  refused.

## The folder

Two settings, edited under Plugins → Installed plugins or from the CLI:

| Key             | Default   | Behavior                                                       |
| --------------- | --------- | -------------------------------------------------------------- |
| `rootDirectory` | `~/Notes` | The folder the panel reads and writes.                         |
| `wikiTagsFile`  | (unset)   | The Wiki's `.wiki/tags.json`; turns on `@` completion (below). |

```sh
bb plugin config notes get rootDirectory
bb plugin config notes set rootDirectory ~/Vault
```

The value must be absolute or start with `~/`; a relative path is refused
rather than resolved against the server's working directory. `~` expands to the
home directory of the account running the BB server. The folder is created if
it does not exist.

## CLI

```sh
bb notes root                            # print the notes folder
bb notes settings [--json]               # show the effective editor settings
bb notes list [--all] [--json]           # list notes; --all includes folders
bb notes read <path>                     # print a note
bb notes write <path> --content <text>   # overwrite a note
bb notes new <path>                      # create an empty note
bb notes mkdir <path>                    # create a folder
bb notes move <from> <to>                # rename or move
bb notes remove <path> [--recursive]     # delete
```

Paths are relative to the notes folder. `write` overwrites without a
compare-and-swap check, so read first if a human may be editing the same note
in the panel; the panel itself does use compare-and-swap and will report a
conflict rather than clobber a change made underneath it.

## Wiki @ completion

When `wikiTagsFile` points at the Wiki plugin's tag list, typing `@` in a note
opens a list of Wiki docs:

```sh
bb plugin config notes set wikiTagsFile ~/Wiki/.wiki/tags.json
bb plugin config notes unset wikiTagsFile   # turn it off
```

- The `@` must start the line or follow whitespace, so an email address such
  as `name@company` does not open the list.
- Each entry shows the doc's tag, its title, and its type (`project`, `topic`,
  or `process`). What you type must match the start of a word in the tag, an
  alias, or the title, so `@cat` finds `adding-config-catalog`. Scattered
  letters do not match, so a mention like `@george` closes the list instead of
  leaving a doc selected for Enter to insert.
- Picking an entry inserts the doc's canonical tag after the `@`, even when an
  alias is what matched, so `@cc` becomes `@adding-config-catalog`.
- The value must be absolute or start with `~/`, like `rootDirectory`. Empty
  or unset means off. The BB server reads the file, so `~` is the home
  directory of the account running it.
- Notes only reads the file. It checks the file's modified time when the
  panel opens, when the editor gains focus, and when the list opens, at most
  once every 2 seconds, and reads the file again only when its modified time
  or size changed.
- The Wiki writes the file. Malformed entries are skipped. A file that is
  missing, is not JSON, has another `version`, or is over 4 MiB gives no
  completions.

```json
{
  "version": 1,
  "docs": [
    {
      "tag": "adding-config-catalog",
      "title": "Adding config catalog",
      "type": "process",
      "aliases": ["cc", "config-catalog"]
    }
  ]
}
```

`bb notes settings` shows the state on its `Wiki tags:` line: `off`, the path
with the number of docs, `(not found)`, or `(not a valid tags.json)`. With
`--json` the same is under `wikiTags` as `{ path, status, docCount }`, where
`status` is `off`, `ok`, `missing`, or `invalid`.

## Editor settings

Notes ships with a set of VS Code preferences already applied — there is no
setup step. Override any of them by putting a `settings.json` in the notes
folder under `.vscode/`, exactly where VS Code would look:

```
~/Notes/.vscode/settings.json
```

That file is JSONC: `//` and `/* */` comments and trailing commas are accepted.
Keys merge over the built-in defaults one at a time, so a file that sets only
`editor.fontSize` keeps the shipped highlight rules. A malformed file is
ignored with a log line rather than blanking the panel. `bb notes settings`
reports which keys are in effect and whether an override was found.

Understood keys:

| Key                                    | Effect                                                     |
| -------------------------------------- | ---------------------------------------------------------- |
| `highlight.regexes`                    | Regex-driven text decorations (see below).                 |
| `highlight.regexFlags`                 | Default flags for those regexes; `gi` as in VS Code.        |
| `markdown.extension.toc.orderedList`   | Numbered (`1.`) rather than bulleted table of contents.     |
| `editor.wordWrap`                      | `on` or `off`; the toolbar also toggles it per session.      |
| `editor.fontSize`                      | Text size in pixels; unset uses the bb base text size.      |
| `editor.lineNumbers`                   | `on` or `relative` shows a line-number gutter; unset or `off` hides it. |

Line numbers are off unless this file turns them on. Settings apply to the open
note as soon as the panel reads them, without reopening it. Unknown keys are
preserved and ignored, so a real VS Code `settings.json` with settings for
other extensions can be dropped in as-is.

### highlight.regexes

Each key is a regular expression; `decorations[i]` styles **capture group
i + 1** (a pattern with no capture groups styles the whole match). This is the
VS Code Highlight extension's format, so its rules port over unchanged.

```jsonc
{
  "highlight.regexes": {
    "(#PRIORITY\\b)": {
      "filterLanguageRegex": "markdown",
      "decorations": [{ "color": "#FF5555", "fontWeight": "bold" }]
    },
    "(#DONE\\b)(.*)": {
      "decorations": [
        { "color": "#50FA7B", "fontWeight": "bold" },
        { "color": "rgba(255, 255, 255, 0.25)" }
      ]
    }
  }
}
```

Supported per decoration: `color`, `backgroundColor`, `fontWeight`,
`fontStyle`, `textDecoration`, `overviewRulerColor` (a mark on the scrollbar).
A `color` of `theme.<workbenchColorId>` — for example
`theme.textLink.activeForeground` — resolves against the active BB code theme,
so it stays readable in light and dark. Values that are not colour-shaped are
dropped rather than written into the stylesheet. `filterFileRegex` and
`filterLanguageRegex` gate a rule by path and by language; the language is
always `markdown` here.

Scanning is per line, and lines over 2000 characters are skipped — the TODO and
FIXME patterns backtrack superlinearly, and a pasted minified blob would
otherwise stall the editor on every keystroke. The rules re-run shortly after
typing pauses.

The rules still apply in live preview. Where a rule and the live-preview
styling cover the same text (a `#DONE` inside bold, a `TODO` in a heading),
the rule's colour and background win. Rules also apply inside fenced code
blocks, matching VS Code — that is the point of the TODO and FIXME patterns.
`overviewRulerColor` draws a short tick in a thin column at the editor's right
edge, at the matching line's position in the note.

There are no built-in per-level heading colours or task colours any more: the
live preview sizes headings and renders tasks as checkboxes, with ticked tasks
struck through and muted.

## Table of contents

The toolbar's table-of-contents button fills the block between
`<!-- toc -->` and `<!-- /toc -->`, rewriting it in place on each press. With
no markers present it inserts the whole block at the cursor, or just below the
YAML frontmatter when the cursor is in it or before it. Either way it is one
undo step. Entries are numbered when `markdown.extension.toc.orderedList` is
true. `#` lines inside
fenced code blocks are not listed, and anchors follow GitHub's rules
(lowercased, punctuation dropped, spaces to hyphens).

## Saving

The panel autosaves: a note is written one second after typing pauses, and
immediately when the editor loses focus, another note opens, the panel closes,
or the window is hidden. `Cmd`/`Ctrl` + `S` saves at once, whether or not the
editor itself has focus. A dot beside the note's path shows unsaved changes.

Saves are compare-and-swap on the file's SHA-256: if the note changed on disk
since it was last read or saved, autosave stops and the panel offers Reload or
Overwrite instead of silently winning. Overwrite replaces the version that
conflicted; if the file changed again since, the conflict is shown again. Any
other failure shows the error with Retry and retries on its own with
a backoff. Opening another note while a save is failing asks before discarding
the unsaved text.

## Routing

The open note is part of the URL — `/plugins/notes/notes/<path>` — so a note
can be linked and restored. Segments are percent-encoded, so a note with a
space in its name links correctly.
