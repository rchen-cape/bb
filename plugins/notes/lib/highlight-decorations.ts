import {
  Prec,
  StateEffect,
  type ChangeDesc,
  type Extension,
  type Range,
  type Text,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type PluginValue,
  type ViewUpdate,
} from "@codemirror/view";
import {
  DecorationStyleSheet,
  resolveColor,
  type WorkbenchColors,
} from "./decoration-styles.js";
import {
  compileHighlightRules,
  findHighlightRanges,
  type CompiledHighlightRule,
} from "./highlight-rules.js";
import type { DecorationStyle, NotesSettings } from "./vscode-settings.js";

export const HIGHLIGHT_DEBOUNCE_MS = 120;

const WORKBENCH_COLOR = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export interface HighlightConfig {
  settings: NotesSettings;
  path: string;
  colors: WorkbenchColors;
}

export interface RulerTick {
  pos: number;
  color: string;
}

export interface HighlightResult {
  decorations: DecorationSet;
  ticks: readonly RulerTick[];
}

export type ClassResolver = (style: DecorationStyle) => string | null;

export interface ThemeColorSource {
  colors: Readonly<Record<string, string>>;
  fg: string;
  bg: string;
}

export function themeColors(theme: ThemeColorSource | null): WorkbenchColors {
  if (theme === null) return {};
  const colors: Record<string, string> = {};
  for (const [id, value] of Object.entries(theme.colors)) {
    if (WORKBENCH_COLOR.test(value)) colors[id] = value;
  }
  if (
    colors["editor.background"] === undefined &&
    WORKBENCH_COLOR.test(theme.bg)
  ) {
    colors["editor.background"] = theme.bg;
  }
  if (
    colors["editor.foreground"] === undefined &&
    WORKBENCH_COLOR.test(theme.fg)
  ) {
    colors["editor.foreground"] = theme.fg;
  }
  return colors;
}

export function compileNoteRules(
  config: HighlightConfig,
): CompiledHighlightRule[] {
  return compileHighlightRules(config.settings, {
    path: config.path,
    languageId: "markdown",
  });
}

export function buildHighlights(
  doc: Text,
  rules: readonly CompiledHighlightRule[],
  classFor: ClassResolver,
  colors: WorkbenchColors,
): HighlightResult {
  const ranges = findHighlightRanges(rules, doc.toJSON());
  const marks: Range<Decoration>[] = [];
  const ticks: RulerTick[] = [];
  const seenTicks = new Set<string>();
  const markFor = new Map<string, Decoration>();
  for (const range of ranges) {
    const line = doc.line(range.lineNumber);
    const from = line.from + range.startColumn - 1;
    const to = Math.min(line.from + range.endColumn - 1, line.to);
    if (to <= from) continue;
    const className = classFor(range.style);
    if (className !== null) {
      let mark = markFor.get(className);
      if (mark === undefined) {
        mark = Decoration.mark({ class: className });
        markFor.set(className, mark);
      }
      marks.push(mark.range(from, to));
    }
    const color = resolveColor(range.style.overviewRulerColor, colors);
    if (color !== undefined) {
      const key = `${range.lineNumber}:${color}`;
      if (!seenTicks.has(key)) {
        seenTicks.add(key);
        ticks.push({ pos: from, color });
      }
    }
  }
  return { decorations: Decoration.set(marks, true), ticks };
}

export function mapTicks(
  ticks: readonly RulerTick[],
  changes: ChangeDesc,
): RulerTick[] {
  return ticks.map((tick) => ({ ...tick, pos: changes.mapPos(tick.pos) }));
}

export function tickOffset(
  documentOffset: number,
  blockTop: number,
  scrollHeight: number,
  trackHeight: number,
): number {
  if (scrollHeight <= 0) return 0;
  const fraction = (documentOffset + blockTop) / scrollHeight;
  return Math.max(0, Math.min(trackHeight - 3, fraction * trackHeight));
}

export const setHighlightConfig = StateEffect.define<HighlightConfig>();

const highlightsDue = StateEffect.define<null>();

const sharedStyles = new DecorationStyleSheet();

interface RulerLayout {
  top: number;
  height: number;
  ticks: readonly { offset: number; color: string }[];
}

class NoteHighlights implements PluginValue {
  decorations: DecorationSet;
  private ticks: readonly RulerTick[];
  private config: HighlightConfig;
  private rules: readonly CompiledHighlightRule[];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly styles = sharedStyles;
  private readonly ruler: HTMLElement;

  constructor(
    private readonly view: EditorView,
    config: HighlightConfig,
  ) {
    this.config = config;
    this.rules = compileNoteRules(config);
    this.ruler = document.createElement("div");
    this.ruler.className = "cm-notes-ruler";
    this.ruler.setAttribute("aria-hidden", "true");
    view.dom.appendChild(this.ruler);
    const result = this.compute(view.state.doc);
    this.decorations = result.decorations;
    this.ticks = result.ticks;
    this.drawRuler();
  }

  update(update: ViewUpdate): void {
    let config: HighlightConfig | null = null;
    let due = false;
    for (const transaction of update.transactions) {
      for (const effect of transaction.effects) {
        if (effect.is(setHighlightConfig)) config = effect.value;
        if (effect.is(highlightsDue)) due = true;
      }
    }
    if (config !== null) {
      this.config = config;
      this.rules = compileNoteRules(config);
      this.styles.reset();
      due = true;
    }
    if (due) {
      this.cancel();
      const result = this.compute(update.state.doc);
      this.decorations = result.decorations;
      this.ticks = result.ticks;
      this.drawRuler();
      return;
    }
    if (update.docChanged) {
      this.decorations = this.decorations.map(update.changes);
      this.ticks = mapTicks(this.ticks, update.changes);
      this.schedule();
    }
    if (update.docChanged || update.geometryChanged) this.drawRuler();
  }

  destroy(): void {
    this.cancel();
    this.ruler.remove();
  }

  private compute(doc: Text): HighlightResult {
    const colors = this.config.colors;
    return buildHighlights(
      doc,
      this.rules,
      (style) => this.styles.classFor(style, colors),
      colors,
    );
  }

  private schedule(): void {
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.view.dispatch({ effects: highlightsDue.of(null) });
    }, HIGHLIGHT_DEBOUNCE_MS);
  }

  private cancel(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private drawRuler(): void {
    const ticks = this.ticks;
    const ruler = this.ruler;
    this.view.requestMeasure<RulerLayout>({
      key: ruler,
      read: (view) => {
        const scroller = view.scrollDOM;
        const height = scroller.clientHeight;
        const documentOffset =
          view.documentTop -
          scroller.getBoundingClientRect().top +
          scroller.scrollTop;
        const length = view.state.doc.length;
        return {
          top: scroller.offsetTop,
          height,
          ticks: ticks.map((tick) => ({
            color: tick.color,
            offset: tickOffset(
              documentOffset,
              view.lineBlockAt(Math.min(tick.pos, length)).top,
              scroller.scrollHeight,
              height,
            ),
          })),
        };
      },
      write: (layout) => {
        ruler.style.top = `${layout.top}px`;
        ruler.style.height = `${layout.height}px`;
        ruler.replaceChildren(
          ...layout.ticks.map((tick) => {
            const mark = document.createElement("div");
            mark.className = "cm-notes-ruler-tick";
            mark.style.top = `${tick.offset}px`;
            mark.style.backgroundColor = tick.color;
            return mark;
          }),
        );
      },
    });
  }
}

const rulerTheme = EditorView.theme({
  ".cm-notes-ruler": {
    position: "absolute",
    right: "0",
    width: "6px",
    pointerEvents: "none",
    zIndex: "2",
  },
  ".cm-notes-ruler-tick": {
    position: "absolute",
    left: "0",
    right: "0",
    height: "3px",
    borderRadius: "1px",
  },
});

export function noteHighlights(config: HighlightConfig): Extension {
  return [
    Prec.highest(
      ViewPlugin.define((view) => new NoteHighlights(view, config), {
        decorations: (plugin) => plugin.decorations,
      }),
    ),
    rulerTheme,
  ];
}
