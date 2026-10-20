# Notes

A live-preview Markdown editor for one folder, `~/Notes` by default, in its own
nav panel. Text looks rendered as you write: headings are large, `**bold**`
is bold, lists show bullets and checkboxes, and tables render as tables. A
construct's Markdown marks (`#`, `**`, `[…](…)`) appear only while the cursor
touches it. Saving changes only what you edited, except that a file with mixed
line endings is saved with the ending most of its lines use.

This is deliberately not the Docs plugin. Docs renders notes as rich text and
manages multiple vaults across hosts; Notes edits the Markdown of one folder in
place and applies regex-driven text decorations to it.

## Features

- **Live preview:** a CodeMirror 6 editor built on the shared core in
  `lib/live-preview/` (the same one the Wiki plugin uses). It keeps the file's
  byte-order mark and line ending (LF, CRLF or CR).
- **Formatting:** selecting text shows a toolbar with Highlight (`==text==`,
  ⌘⇧H), Bold (⌘B), Italic (⌘I), Strikethrough (⌘⇧S), Code (⌘E) and Link (⌘K).
  Typing `/` on an empty line opens a block menu: text, headings, lists, to-do
  list, quote, code block, divider and table. Tab indents list items and code
  and accepts an open completion; elsewhere it does nothing. ⌘⇧K deletes the
  line and ⌘Enter opens a new line below.
- **Find, wrap and line numbers:** ⌘F find and replace, ⌘D select the next
  match, word wrap on by default. A selected match inside hidden Markdown, such
  as the collapsed frontmatter, is shown. Line numbers are off unless
  `editor.lineNumbers` turns them on. Fenced code is coloured from the active
  bb code theme.
- **Imported VS Code preferences:** the shipped defaults include a working
  `highlight.regexes` set, applied on first open with no setup. A
  `.vscode/settings.json` in the notes folder overrides them key by key, and
  changes apply to the open note without reopening it. A rule's colours win
  over the live-preview styling where both apply, and `overviewRulerColor`
  draws a tick at the scrollbar's edge.
- **Files and folders:** create, rename, delete, and search from the sidebar,
  all scoped to the notes folder. Folders start collapsed and the ones you
  open stay open the next time the panel opens.
- **Autosave:** a note saves a second after typing pauses, and right away when
  the editor loses focus, another note opens, or the panel closes. Saves are
  compare-and-swap on SHA-256, so a note changed on disk stops autosave and
  offers Reload or Overwrite rather than being clobbered. Failed saves retry on
  a backoff. Undoing back to the saved text counts as saved. Reload replaces the
  note with the disk version and starts a new undo history.
- **Table of contents:** fills the `<!-- toc -->` block, numbered when
  `markdown.extension.toc.orderedList` is set, as one undo step. Clicking a
  rendered TOC link scrolls to its heading. A TOC inserted while the cursor is in
  or before the frontmatter goes below it.
- **Links:** clicking a rendered link opens web links in bb and relative links
  to another note (`[Plan](plan.md)`) in the panel. When a link cannot be
  opened (an unknown note, a heading that no longer exists, `mailto:`), the
  click puts the cursor in the link instead so you can edit it.
- **Wiki `@` completion:** with `wikiTagsFile` pointed at the Wiki plugin's
  `.wiki/tags.json`, typing `@` at the start of a line or after a space lists
  Wiki docs, matched by tag, alias, or title, and inserts the doc's tag. Notes
  only reads that file and never imports Wiki code.
- **CLI:** `bb notes list|read|write|new|mkdir|move|remove|settings|root`.

## Configuration

Two plugin settings: `rootDirectory` (default `~/Notes`) and `wikiTagsFile`
(no default; empty or unset turns `@` completion off). Both must be absolute or
start with `~/`. Editor behavior comes from `<root>/.vscode/settings.json`. All
of it is documented in [skills/notes/SKILL.md](skills/notes/SKILL.md).

## Safety

Every path from the panel is resolved against the notes root and rejected if it
escapes it, so `..` or an absolute path cannot reach the rest of the disk. Only
Markdown extensions are readable or writable. Decoration styles from a settings
file are validated against colour and keyword shapes before they reach a
stylesheet, and the notes root itself cannot be deleted.

## Bundle

The editor is part of `dist/app.js` (about 850 KB minified, 270 KB gzip),
because the plugin build emits one file with no code splitting. Notes is on by
default, so bb loads this file at startup even when the panel stays closed; the
Monaco build it replaced loaded its 4.4 MB editor only when the panel opened.
Fenced-code colouring uses CodeMirror's legacy modes for a fixed list of
languages instead of `@codemirror/language-data`, and the Markdown language is
built from `commonmarkLanguage` rather than `markdown()`, which would pull in
the HTML, CSS and JavaScript parsers.

## Layout

| Path                            | Role                                                          |
| ------------------------------- | ------------------------------------------------------------- |
| `server.ts`                     | RPC contract, file operations, settings merge, `bb notes`.    |
| `app.tsx`                       | The nav panel: routing, editor lifecycle, save state.         |
| `components/`                   | Sidebar tree and toolbar.                                     |
| `lib/live-preview/`             | Shared live-preview core; the Wiki plugin owns the canonical copy. |
| `lib/note-editor.ts`            | One note's CodeMirror editor: extensions, live settings, TOC. |
| `lib/highlight-decorations.ts`  | `highlight.regexes` as editor decorations and scrollbar ticks. |
| `lib/notes-path.ts`             | Root resolution and containment checks.                       |
| `lib/vscode-settings.ts`        | The imported defaults, JSONC parsing, merge.                  |
| `lib/highlight-rules.ts`        | Compiles `highlight.regexes` and scans a document.            |
| `lib/decoration-styles.ts`      | Validates styles into interned CSS classes.                   |
| `lib/fenced-code.ts`            | Fence detection for the TOC.                                  |
| `lib/toc.ts`                    | Heading collection, anchors, TOC block rewriting.             |
| `lib/notes-tree.ts`             | Tree building, filtering, name validation, route decoding.    |
| `lib/autosave.ts`               | Debounced compare-and-swap autosave, conflicts, retries.      |
| `lib/expanded-folders.ts`       | Remembered open folders, pruned and remapped on rename.       |
| `lib/wiki-tags.ts`              | Wiki `tags.json` parsing and the `wikiTagsFile` path.         |
| `lib/wiki-completion.ts`        | The `@` completion source and its throttled tag cache.        |
