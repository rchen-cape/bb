import { acceptCompletion, autocompletion } from "@codemirror/autocomplete";
import {
  deleteLine,
  insertBlankLine,
  isolateHistory,
} from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import {
  ChangeSet,
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
  RangeSet,
  StateField,
  type Extension,
  type Range,
  type StateEffect,
  type Text,
  type TransactionSpec,
} from "@codemirror/state";
import {
  EditorView,
  GutterMarker,
  ViewPlugin,
  gutter,
  gutterLineClass,
  keymap,
  lineNumbers,
  type PluginValue,
} from "@codemirror/view";
import type { PluginCodeThemeData } from "@get-bb/plugin-sdk/app";
import type { AutosaveDocument } from "./autosave.js";
import {
  noteHighlights,
  setHighlightConfig,
  themeColors,
  type HighlightConfig,
} from "./highlight-decorations.js";
import {
  codeHighlighting,
  contentVersion,
  editorBasics,
  externalChange,
  formattingToolbar,
  frontmatterInText,
  headingLevel,
  livePreview,
  livePreviewTheme,
  minimalChange,
  openDocument,
  previewValue,
  saveDocument,
  setPreviewFocus,
  slashCommandSource,
  type DocumentFormat,
} from "./live-preview/index.js";
import { resolveNoteLink } from "./note-links.js";
import { anchorFor, collectHeadings, tocBlock, updateTocBlock } from "./toc.js";
import type { NotesSettings } from "./vscode-settings.js";
import { wikiTagSource, type WikiTagsSource } from "./wiki-completion.js";

export interface NoteCodeTheme {
  mode: "light" | "dark";
  theme: PluginCodeThemeData | null;
}

export interface NoteEditorConfig {
  settings: NotesSettings;
  codeTheme: NoteCodeTheme;
  wordWrap: boolean;
}

export interface NoteEditorHandlers {
  onChange: () => void;
  onFocus: () => void;
  onBlur: () => void;
  onSave: () => void;
  openUrl: (href: string) => boolean;
  openNote: (path: string) => boolean;
}

export interface NoteEditorOptions {
  parent: HTMLElement;
  path: string;
  content: string;
  config: NoteEditorConfig;
  handlers: NoteEditorHandlers;
  wikiTags: WikiTagsSource;
}

export type TocOutcome = "updated" | "no-headings" | "inserted";

export interface TocPlan {
  outcome: TocOutcome;
  spec: TransactionSpec | null;
}

export interface NoteEditor {
  readonly view: EditorView;
  readonly document: AutosaveDocument;
  configure: (config: NoteEditorConfig) => void;
  replaceContent: (content: string) => void;
  insertToc: (orderedList: boolean) => TocOutcome;
  scrollToAnchor: (anchor: string) => boolean;
  destroy: () => void;
}

export function noteAutosaveDocument(
  getDoc: () => Text,
  getFormat: () => DocumentFormat,
): AutosaveDocument {
  let cached: {
    doc: Text;
    format: DocumentFormat;
    value: string;
    version: number;
  } | null = null;
  const snapshot = () => {
    const doc = getDoc();
    const format = getFormat();
    if (cached !== null && cached.doc === doc && cached.format === format) {
      return cached;
    }
    const value = saveDocument(doc, format);
    cached = { doc, format, value, version: contentVersion(value) };
    return cached;
  };
  return {
    getValue: () => snapshot().value,
    getAlternativeVersionId: () => snapshot().version,
  };
}

function tocInsertRange(
  current: string,
  from: number,
  to: number,
): { from: number; to: number; prefix: string } {
  const bounds = frontmatterInText(current);
  if (bounds === null || from > bounds.to) return { from, to, prefix: "" };
  if (bounds.to >= current.length) {
    return { from: current.length, to: current.length, prefix: "\n" };
  }
  return { from: bounds.to + 1, to: bounds.to + 1, prefix: "" };
}

export function tocPlan(state: EditorState, orderedList: boolean): TocPlan {
  const current = state.doc.toString();
  const updated = updateTocBlock(current, { orderedList });
  if (updated.replaced) {
    const change = minimalChange(current, updated.content);
    return {
      outcome: "updated",
      spec:
        change === null
          ? null
          : { changes: change, annotations: isolateHistory.of("full") },
    };
  }
  if (collectHeadings(state.doc.toJSON()).length === 0) {
    return { outcome: "no-headings", spec: null };
  }
  const range = state.selection.main;
  const target = tocInsertRange(current, range.from, range.to);
  const insert = target.prefix + tocBlock(current, { orderedList });
  return {
    outcome: "inserted",
    spec: {
      changes: { from: target.from, to: target.to, insert },
      selection: EditorSelection.cursor(target.from + insert.length),
      annotations: isolateHistory.of("full"),
      scrollIntoView: true,
    },
  };
}

function decodeAnchor(anchor: string): string {
  try {
    return decodeURIComponent(anchor);
  } catch {
    return anchor;
  }
}

export function headingPosition(doc: Text, anchor: string): number | null {
  const wanted = decodeAnchor(anchor).toLowerCase();
  const heading = collectHeadings(doc.toJSON()).find(
    (candidate) => anchorFor(candidate.text) === wanted,
  );
  return heading === undefined ? null : doc.line(heading.lineNumber).from;
}

export function relativeLineLabel(
  state: EditorState,
  lineNumber: number,
): string {
  const current = state.doc.lineAt(state.selection.main.head).number;
  return String(
    lineNumber === current ? lineNumber : Math.abs(lineNumber - current),
  );
}

class LineLabel extends GutterMarker {
  constructor(readonly label: string) {
    super();
  }

  override eq(other: GutterMarker): boolean {
    return other instanceof LineLabel && other.label === this.label;
  }

  override toDOM(): Node {
    return document.createTextNode(this.label);
  }
}

function relativeLineNumbers(): Extension {
  return gutter({
    class: "cm-lineNumbers",
    lineMarker: (view, line) =>
      new LineLabel(
        relativeLineLabel(view.state, view.state.doc.lineAt(line.from).number),
      ),
    lineMarkerChange: (update) => update.selectionSet || update.docChanged,
    initialSpacer: (view) => new LineLabel(String(view.state.doc.lines)),
  });
}

const GUTTER_HEADING_LEVELS = 4;

const STRUCTURAL_BLOCKS = new Set([
  "Document",
  "Blockquote",
  "BulletList",
  "OrderedList",
  "ListItem",
]);

class HeadingGutterClass extends GutterMarker {
  constructor(readonly level: number) {
    super();
    this.elementClass = `cm-notes-gutter-h${level}`;
  }

  override eq(other: GutterMarker): boolean {
    return other instanceof HeadingGutterClass && other.level === this.level;
  }
}

const headingGutterMarkers = Array.from(
  { length: GUTTER_HEADING_LEVELS },
  (_, index) => new HeadingGutterClass(index + 1),
);

export function headingGutterLines(
  state: EditorState,
): { line: number; level: number }[] {
  const found: { line: number; level: number }[] = [];
  const doc = state.doc;
  syntaxTree(state).iterate({
    enter: (node) => {
      if (STRUCTURAL_BLOCKS.has(node.name)) return true;
      const setext = /^SetextHeading(\d)$/.exec(node.name);
      const level =
        setext === null ? headingLevel(node.name) : Number(setext[1]);
      if (level !== null && level <= GUTTER_HEADING_LEVELS) {
        const first = doc.lineAt(node.from).number;
        const last =
          setext === null
            ? first
            : Math.max(first, doc.lineAt(node.to).number - 1);
        for (let line = first; line <= last; line += 1) {
          found.push({ line, level });
        }
      }
      return false;
    },
  });
  return found;
}

function headingGutterSet(state: EditorState): RangeSet<GutterMarker> {
  const ranges: Range<GutterMarker>[] = [];
  for (const { line, level } of headingGutterLines(state)) {
    const marker = headingGutterMarkers[level - 1];
    if (marker !== undefined) {
      ranges.push(marker.range(state.doc.line(line).from));
    }
  }
  return RangeSet.of(ranges, true);
}

const headingGutterClasses = StateField.define<RangeSet<GutterMarker>>({
  create: headingGutterSet,
  update: (value, transaction) =>
    transaction.docChanged ||
    syntaxTree(transaction.state) !== syntaxTree(transaction.startState)
      ? headingGutterSet(transaction.state)
      : value,
  provide: (field) => gutterLineClass.from(field),
});

const HEADING_CENTER_EM = ["1.956", "1.565", "1.395", "0.934"];

function numberedLayout(fontSize: string): Extension {
  const headings: Record<string, { paddingTop: string }> = {};
  HEADING_CENTER_EM.forEach((center, index) => {
    headings[
      `.cm-lineNumbers .cm-gutterElement.cm-notes-gutter-h${index + 1}`
    ] = {
      paddingTop: `calc(var(--notes-gutter-base) * ${center} - var(--text-xs) * 0.85)`,
    };
  });
  return Prec.high(
    EditorView.theme({
      "&": { "--notes-gutter-base": fontSize },
      ".cm-gutters": { marginLeft: "auto" },
      ".cm-content": {
        marginLeft: "0",
        width: "auto",
        minWidth: "0",
        flexShrink: "1",
      },
      ...headings,
    }),
  );
}

export function lineNumbersFor(settings: NotesSettings): Extension {
  const layout = [
    headingGutterClasses,
    numberedLayout(fontSizeFor(settings) ?? "var(--text-base)"),
  ];
  switch (settings["editor.lineNumbers"]) {
    case "on":
      return [lineNumbers(), layout];
    case "relative":
      return [relativeLineNumbers(), layout];
    default:
      return [];
  }
}

export function fontSizeFor(settings: NotesSettings): string | undefined {
  const size = settings["editor.fontSize"];
  return size === undefined ? undefined : `${size}px`;
}

function highlightConfig(
  path: string,
  config: NoteEditorConfig,
): HighlightConfig {
  return {
    settings: config.settings,
    path,
    colors: themeColors(config.codeTheme.theme),
  };
}

const notesLayout = EditorView.theme({
  "&": { flex: "1 1 0", minHeight: "0" },
});

const searchReveal: Extension = [
  EditorState.transactionExtender.of((transaction) =>
    (transaction.isUserEvent("select.search") ||
      transaction.isUserEvent("input.replace")) &&
    !previewValue(transaction.startState).focused
      ? { effects: setPreviewFocus.of(true) }
      : null,
  ),
  ViewPlugin.fromClass(
    class implements PluginValue {
      constructor(private readonly view: EditorView) {
        view.dom.addEventListener("focusout", this.left);
      }

      private readonly left = (event: FocusEvent): void => {
        const view = this.view;
        if (event.target === view.contentDOM) return;
        const next = event.relatedTarget;
        if (next instanceof Node && view.dom.contains(next)) return;
        if (previewValue(view.state).focused && !view.hasFocus) {
          view.dispatch({ effects: setPreviewFocus.of(false) });
        }
      };

      destroy(): void {
        this.view.dom.removeEventListener("focusout", this.left);
      }
    },
  ),
];

const noteKeys: Extension = [
  Prec.highest(keymap.of([{ key: "Tab", run: acceptCompletion }])),
  keymap.of([
    { key: "Shift-Mod-k", run: deleteLine },
    { key: "Mod-Enter", run: insertBlankLine },
  ]),
];

interface Press {
  x: number;
  y: number;
  target: EventTarget | null;
}

export function createNoteEditor(options: NoteEditorOptions): NoteEditor {
  const { handlers, path } = options;
  const opened = openDocument(options.content);
  let format = opened.format;
  let config = options.config;

  const wrap = new Compartment();
  const look = new Compartment();
  const numbers = new Compartment();
  const code = new Compartment();
  const dark = new Compartment();

  let view: EditorView | null = null;
  let press: Press | null = null;

  const scrollToAnchor = (anchor: string): boolean => {
    if (view === null) return false;
    const pos = headingPosition(view.state.doc, anchor);
    if (pos === null) return false;
    view.dispatch({
      effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 24 }),
    });
    return true;
  };

  const placeCursorAtPress = () => {
    const current = view;
    const last = press;
    if (current === null || last === null) return;
    const target = last.target;
    if (!(target instanceof Node) || !current.contentDOM.contains(target)) {
      return;
    }
    const start = current.posAtDOM(target, 0);
    const end = current.posAtDOM(target, target.childNodes.length);
    const hit = current.posAtCoords({ x: last.x, y: last.y });
    const pos = hit !== null && hit >= start && hit <= end ? hit : start;
    current.focus();
    current.dispatch({
      selection: EditorSelection.cursor(pos),
      userEvent: "select.pointer",
    });
  };

  const openLink = (href: string) => {
    const target = resolveNoteLink(path, href);
    let opened = false;
    switch (target.kind) {
      case "anchor":
        opened = scrollToAnchor(target.anchor);
        break;
      case "note":
        opened = handlers.openNote(target.path);
        break;
      case "url":
        opened = handlers.openUrl(target.href);
        break;
      case "none":
        break;
    }
    if (!opened) placeCursorAtPress();
  };

  const basics = editorBasics({
    ariaLabel: `Note ${path}`,
    lineWrapping: false,
  });
  const preview = livePreview({ openLink, frontmatter: "collapse" });
  const toolbar = formattingToolbar();
  const searching = [search({ top: true }), keymap.of(searchKeymap)];
  const completion = autocompletion({
    override: [slashCommandSource, wikiTagSource(options.wikiTags)],
    icons: false,
  });
  const saveKey = Prec.high(
    keymap.of([
      {
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          handlers.onSave();
          return true;
        },
      },
    ]),
  );
  const pressTracker = Prec.highest(
    EditorView.domEventHandlers({
      mousedown(event) {
        press = { x: event.clientX, y: event.clientY, target: event.target };
        return false;
      },
    }),
  );
  const listener = EditorView.updateListener.of((update) => {
    if (
      update.transactions.some(
        (transaction) =>
          transaction.docChanged &&
          transaction.annotation(externalChange) !== true,
      )
    ) {
      handlers.onChange();
    }
    if (update.focusChanged) {
      if (update.view.hasFocus) handlers.onFocus();
      else handlers.onBlur();
    }
  });

  const extensionsFor = (current: NoteEditorConfig): Extension[] => [
    basics,
    wrap.of(current.wordWrap ? EditorView.lineWrapping : []),
    preview,
    toolbar,
    look.of(
      livePreviewTheme({
        scroll: "self",
        fontSize: fontSizeFor(current.settings),
      }),
    ),
    code.of(codeHighlighting(current.codeTheme.theme)),
    dark.of(EditorView.darkTheme.of(current.codeTheme.mode === "dark")),
    numbers.of(lineNumbersFor(current.settings)),
    searching,
    searchReveal,
    completion,
    noteKeys,
    noteHighlights(highlightConfig(path, current)),
    saveKey,
    pressTracker,
    listener,
    notesLayout,
  ];

  const created = new EditorView({
    parent: options.parent,
    state: EditorState.create({
      doc: opened.text,
      extensions: extensionsFor(config),
    }),
  });
  view = created;

  const configure = (next: NoteEditorConfig) => {
    const effects: StateEffect<unknown>[] = [];
    if (next.wordWrap !== config.wordWrap) {
      effects.push(
        wrap.reconfigure(next.wordWrap ? EditorView.lineWrapping : []),
      );
    }
    const fontChanged =
      fontSizeFor(next.settings) !== fontSizeFor(config.settings);
    if (fontChanged) {
      effects.push(
        look.reconfigure(
          livePreviewTheme({
            scroll: "self",
            fontSize: fontSizeFor(next.settings),
          }),
        ),
      );
    }
    if (
      fontChanged ||
      next.settings["editor.lineNumbers"] !==
        config.settings["editor.lineNumbers"]
    ) {
      effects.push(numbers.reconfigure(lineNumbersFor(next.settings)));
    }
    if (next.codeTheme.theme !== config.codeTheme.theme) {
      effects.push(code.reconfigure(codeHighlighting(next.codeTheme.theme)));
    }
    if (next.codeTheme.mode !== config.codeTheme.mode) {
      effects.push(
        dark.reconfigure(
          EditorView.darkTheme.of(next.codeTheme.mode === "dark"),
        ),
      );
    }
    if (
      next.settings !== config.settings ||
      next.codeTheme.theme !== config.codeTheme.theme
    ) {
      effects.push(setHighlightConfig.of(highlightConfig(path, next)));
    }
    config = next;
    if (effects.length > 0) created.dispatch({ effects });
  };

  const replaceContent = (content: string) => {
    const next = openDocument(content);
    format = next.format;
    const state = created.state;
    const change = minimalChange(state.doc.toString(), next.text);
    if (change === null) return;
    const changes = ChangeSet.of(change, state.doc.length);
    const scroll = created.scrollSnapshot().map(changes);
    created.setState(
      EditorState.create({
        doc: next.text,
        selection: state.selection.map(changes),
        extensions: extensionsFor(config),
      }),
    );
    const effects: StateEffect<unknown>[] = [];
    if (scroll !== undefined) effects.push(scroll);
    if (created.hasFocus) effects.push(setPreviewFocus.of(true));
    if (effects.length > 0) created.dispatch({ effects });
  };

  const insertToc = (orderedList: boolean): TocOutcome => {
    const plan = tocPlan(created.state, orderedList);
    if (plan.spec !== null) created.dispatch(plan.spec);
    return plan.outcome;
  };

  return {
    view: created,
    document: noteAutosaveDocument(
      () => created.state.doc,
      () => format,
    ),
    configure,
    replaceContent,
    insertToc,
    scrollToAnchor,
    destroy: () => {
      view = null;
      created.destroy();
    },
  };
}
