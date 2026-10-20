import { ChangeSet, Text } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { resolveColor, type WorkbenchColors } from "./decoration-styles.js";
import {
  buildHighlights,
  compileNoteRules,
  mapTicks,
  themeColors,
  tickOffset,
  type ClassResolver,
} from "./highlight-decorations.js";
import {
  IMPORTED_VSCODE_SETTINGS,
  type DecorationStyle,
  type NotesSettings,
} from "./vscode-settings.js";

interface MarkedRange {
  from: number;
  to: number;
  className: string;
}

function marks(set: DecorationSet): MarkedRange[] {
  const found: MarkedRange[] = [];
  set.between(0, Number.MAX_SAFE_INTEGER, (from, to, value) => {
    const className = value.spec.class;
    if (typeof className === "string") found.push({ from, to, className });
  });
  return found;
}

function byColor(colors: WorkbenchColors): ClassResolver {
  return (style: DecorationStyle) => {
    const parts = [
      resolveColor(style.color, colors),
      resolveColor(style.backgroundColor, colors),
    ].filter((part) => part !== undefined);
    return parts.length === 0 ? null : `hl-${parts.join("-")}`;
  };
}

function highlight(
  text: string,
  settings: NotesSettings = IMPORTED_VSCODE_SETTINGS,
  options: { path?: string; colors?: Record<string, string> } = {},
) {
  const doc = Text.of(text.split("\n"));
  const colors = options.colors ?? {};
  const rules = compileNoteRules({
    settings,
    path: options.path ?? "note.md",
    colors,
  });
  return { doc, ...buildHighlights(doc, rules, byColor(colors), colors) };
}

const SIMPLE: NotesSettings = {
  "highlight.regexes": {
    "(TODO)(:)?": {
      regexFlags: "g",
      decorations: [
        { backgroundColor: "#ffcc00", overviewRulerColor: "#ffcc00" },
        { color: "theme.textLink.activeForeground" },
      ],
    },
    "(@\\w+)": {
      regexFlags: "g",
      decorations: [{ overviewRulerColor: "theme.missing" }],
    },
  },
};

describe("buildHighlights", () => {
  it("turns line and column matches into document offsets", () => {
    const { doc, decorations } = highlight(
      "intro\n- TODO: ship\nTODO",
      SIMPLE,
      {
        colors: { "textLink.activeForeground": "#3794ff" },
      },
    );
    const found = marks(decorations);
    expect(found).toEqual([
      { from: 8, to: 12, className: "hl-#ffcc00" },
      { from: 12, to: 13, className: "hl-#3794ff" },
      { from: 19, to: 23, className: "hl-#ffcc00" },
    ]);
    expect(doc.sliceString(8, 12)).toBe("TODO");
    expect(doc.sliceString(19, 23)).toBe("TODO");
  });

  it("drops a theme colour the code theme does not define", () => {
    const { decorations } = highlight("TODO: x", SIMPLE);
    expect(marks(decorations).map((range) => range.className)).toEqual([
      "hl-#ffcc00",
    ]);
  });

  it("puts one scrollbar tick per line and colour, even for ruler-only styles", () => {
    const { ticks } = highlight("TODO TODO\n@a\nTODO", SIMPLE);
    expect(ticks).toEqual([
      { pos: 0, color: "#ffcc00" },
      { pos: 13, color: "#ffcc00" },
    ]);
  });

  it("sorts ranges that arrive out of order within a line", () => {
    const settings: NotesSettings = {
      "highlight.regexes": {
        "(b)": { regexFlags: "g", decorations: [{ color: "red" }] },
        "(a)": { regexFlags: "g", decorations: [{ color: "blue" }] },
      },
    };
    const { decorations } = highlight("a b", settings);
    expect(marks(decorations)).toEqual([
      { from: 0, to: 1, className: "hl-blue" },
      { from: 2, to: 3, className: "hl-red" },
    ]);
  });

  it("applies the imported rules, file filters included", () => {
    const text = "#DONE shipped\n// FIXME later\nsee https://bb.dev";
    const inNote = highlight(text);
    expect(marks(inNote.decorations).length).toBeGreaterThan(0);
    expect(inNote.ticks.length).toBeGreaterThan(0);
    const inChangelog = highlight("// TODO later", IMPORTED_VSCODE_SETTINGS, {
      path: "CHANGELOG.md",
    });
    expect(inChangelog.ticks).toEqual([]);
    expect(highlight("// TODO later").ticks).toEqual([
      { pos: 0, color: "#ffcc00" },
    ]);
  });

  it("returns nothing without highlight rules", () => {
    const { decorations, ticks } = highlight("TODO", {});
    expect(marks(decorations)).toEqual([]);
    expect(ticks).toEqual([]);
  });
});

describe("mapTicks", () => {
  it("moves ticks with an edit above them", () => {
    const changes = ChangeSet.of({ from: 0, insert: "new\n" }, 10);
    expect(mapTicks([{ pos: 5, color: "red" }], changes)).toEqual([
      { pos: 9, color: "red" },
    ]);
  });
});

describe("tickOffset", () => {
  it("scales a block's position to the track", () => {
    expect(tickOffset(40, 460, 1000, 200)).toBe(100);
  });

  it("keeps the tick inside the track", () => {
    expect(tickOffset(0, 5000, 1000, 200)).toBe(197);
    expect(tickOffset(0, 10, 0, 200)).toBe(0);
  });
});

describe("themeColors", () => {
  it("keeps hex workbench colours and fills editor colours from the theme", () => {
    expect(
      themeColors({
        colors: {
          "textLink.activeForeground": "#3794ff",
          "editor.lineHighlightBorder": "rgba(1,2,3,0.4)",
        },
        fg: "#cccccc",
        bg: "#1e1e1e",
      }),
    ).toEqual({
      "textLink.activeForeground": "#3794ff",
      "editor.background": "#1e1e1e",
      "editor.foreground": "#cccccc",
    });
  });

  it("is empty before the theme loads", () => {
    expect(themeColors(null)).toEqual({});
  });
});
