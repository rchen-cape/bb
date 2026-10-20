A live-preview Markdown editor for your notes folder, in its own panel. It opens the files in `~/Notes` and shows them the way they will read: large headings, real bold and italic, bullets, checkboxes and tables. The Markdown marks appear only where your cursor is, so you can still edit them, and the file stays plain Markdown.

## What you get

- A file tree for your notes folder. Create notes and folders, rename, delete, and filter by name. Only Markdown files appear, so the folder's other files are left alone. Folders start collapsed, and the ones you open stay open when you come back to the panel.
- Writing that feels like a document. Select text to get a small toolbar for highlight, bold, italic, strikethrough, code and links. Highlighted text is saved as `==text==`, and ⌘⇧H highlights the selection. Type `/` on an empty line for headings, lists, to-do lists, quotes, code blocks, dividers and tables. Click a checkbox to tick a task.
- Your own highlight rules. Notes understands the `highlight.regexes` format from VS Code's Highlight extension, so tags such as `#PRIORITY`, `#DONE`, `TODO`, and `FIXME` can be coloured, given a background, struck through, or marked on the scrollbar. A useful set is applied out of the box, and your rules' colours win over the editor's own styling.
- A table of contents button that fills the block between `<!-- toc -->` and `<!-- /toc -->` and refreshes it whenever you press it again. Clicking an entry jumps to that heading.
- Find and replace in the note, word wrap, and code blocks coloured to match your bb code theme. A link to another note, such as `[Plan](plan.md)`, opens that note in the panel.
- Wiki doc names as you type, if you use the Wiki plugin. Type `@` at the start of a line or after a space, and Notes lists your Wiki docs. You can find a doc by its tag, title, or aliases, and picking one inserts the doc's tag.
- Autosave: a note saves a second after you stop typing, and right away when you click out of the editor, open another note, or leave the panel. Cmd+S, or Ctrl+S on Linux and Windows, saves immediately. If the note changed on disk since you opened it, autosave stops and offers Reload or Overwrite.

## How it works

Notes reads one folder on your primary machine. Change which folder under Plugins, or with `bb plugin config notes set rootDirectory ~/Vault`. The folder is created if it is not there yet.

To turn on `@` completion, point Notes at the Wiki's tag list, for example `bb plugin config notes set wikiTagsFile ~/Wiki/.wiki/tags.json`. It is off until you set it. Notes only reads that file, and picks up changes to it within a couple of seconds.

To change how the editor behaves, put a `settings.json` in your notes folder under `.vscode/`, exactly where VS Code would look. Comments and trailing commas are allowed. It overrides the shipped defaults one setting at a time, so you only write the keys you want to change. Notes reads `highlight.regexes`, `markdown.extension.toc.orderedList`, `editor.wordWrap`, `editor.fontSize`, and `editor.lineNumbers`, and ignores settings meant for other extensions. Line numbers stay off unless `editor.lineNumbers` is `on` or `relative`.

Notes is for Markdown only, and there is no language server. For rich-text notes across several folders and machines, use the Docs plugin instead.

Everything in the panel is also available from the command line with `bb notes`.
