// @vitest-environment jsdom
import { completionStatus, startCompletion } from "@codemirror/autocomplete";
import { undo, undoDepth } from "@codemirror/commands";
import {
  SearchQuery,
  findNext,
  openSearchPanel,
  replaceNext,
  setSearchQuery,
} from "@codemirror/search";
import { EditorSelection } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HIGHLIGHT_DEBOUNCE_MS } from "./highlight-decorations.js";
import { previewValue } from "./live-preview/index.js";
import { installDomPolyfills } from "./live-preview/test-dom.js";
import {
  createNoteEditor,
  type NoteEditor,
  type NoteEditorConfig,
  type NoteEditorHandlers,
} from "./note-editor.js";
import type { NotesSettings } from "./vscode-settings.js";
import type { WikiTagsSource } from "./wiki-completion.js";

installDomPolyfills();

const editors: NoteEditor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
  vi.useRealTimers();
});

const RULES: NotesSettings = {
  "highlight.regexes": {
    "(TODO)": {
      regexFlags: "g",
      decorations: [
        { backgroundColor: "#ffcc00", overviewRulerColor: "#ffcc00" },
      ],
    },
  },
};

const wikiTags: WikiTagsSource = {
  call: async () => ({ status: "off" }),
};

function config(overrides: Partial<NoteEditorConfig> = {}): NoteEditorConfig {
  return {
    settings: RULES,
    codeTheme: { mode: "light", theme: null },
    wordWrap: true,
    ...overrides,
  };
}

interface MountOptions {
  config?: NoteEditorConfig;
  openUrl?: (href: string) => boolean;
  openNote?: (path: string) => boolean;
  wikiTags?: WikiTagsSource;
}

function mount(content: string, options: MountOptions = {}) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const handlers: NoteEditorHandlers = {
    onChange: vi.fn(),
    onFocus: vi.fn(),
    onBlur: vi.fn(),
    onSave: vi.fn(),
    openUrl: vi.fn(options.openUrl ?? (() => true)),
    openNote: vi.fn(options.openNote ?? (() => true)),
  };
  const editor = createNoteEditor({
    parent,
    path: "work/plan.md",
    content,
    config: options.config ?? config(),
    handlers,
    wikiTags: options.wikiTags ?? wikiTags,
  });
  editors.push(editor);
  return { editor, handlers, parent };
}

function typeAt(view: EditorView, pos: number, text: string): void {
  view.dispatch({
    changes: { from: pos, insert: text },
    selection: EditorSelection.cursor(pos + text.length),
    userEvent: "input.type",
  });
}

function mouse(type: string): MouseEvent {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: type === "mousedown" ? 1 : 0,
  });
}

function highlighted(parent: HTMLElement): string[] {
  return [...parent.querySelectorAll("[class*='bb-notes-hl-']")].map(
    (element) => element.textContent ?? "",
  );
}

describe("createNoteEditor", () => {
  it("mounts a labelled live-preview editor with no line numbers by default", () => {
    const { parent } = mount("# Plan\n\nSome **bold** text\n");
    const content = parent.querySelector(".cm-content");
    expect(content?.getAttribute("aria-label")).toBe("Note work/plan.md");
    expect(parent.querySelector(".cm-lp-h1")).not.toBeNull();
    expect(parent.querySelector(".cm-lineNumbers")).toBeNull();
    expect(parent.querySelector(".cm-lineWrapping")).not.toBeNull();
  });

  it("reports user edits but not outside reloads", () => {
    const { editor, handlers } = mount("draft\r\n");
    typeAt(editor.view, 5, "!");
    expect(handlers.onChange).toHaveBeenCalledTimes(1);
    expect(editor.document.getValue()).toBe("draft!\r\n");

    editor.replaceContent("from disk\n");
    expect(handlers.onChange).toHaveBeenCalledTimes(1);
    expect(editor.view.state.doc.toString()).toBe("from disk\n");
    expect(editor.document.getValue()).toBe("from disk\n");
  });

  it("saves on Mod-S and stops the window shortcut from saving again", () => {
    const { editor, handlers } = mount("draft");
    const event = new KeyboardEvent("keydown", {
      key: "s",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    expect(runScopeHandlers(editor.view, event, "editor")).toBe(true);
    expect(handlers.onSave).toHaveBeenCalledTimes(1);
  });

  it("applies settings and word wrap live", () => {
    const { editor, parent } = mount("a\nb");
    editor.configure(
      config({
        wordWrap: false,
        settings: {
          ...RULES,
          "editor.lineNumbers": "on",
          "editor.fontSize": 15,
        },
      }),
    );
    expect(parent.querySelector(".cm-lineWrapping")).toBeNull();
    expect(parent.querySelector(".cm-lineNumbers")).not.toBeNull();

    editor.configure(
      config({ settings: { ...RULES, "editor.lineNumbers": "relative" } }),
    );
    expect(parent.querySelector(".cm-lineWrapping")).not.toBeNull();
    expect(parent.querySelector(".cm-lineNumbers")).not.toBeNull();
  });

  it("highlights rule matches and re-scans shortly after typing", async () => {
    vi.useFakeTimers();
    const { editor, parent } = mount("TODO first\n");
    expect(highlighted(parent)).toEqual(["TODO"]);
    expect(parent.querySelector(".cm-notes-ruler")).not.toBeNull();

    typeAt(editor.view, editor.view.state.doc.length, "TODO again");
    expect(highlighted(parent)).toEqual(["TODO"]);
    await vi.advanceTimersByTimeAsync(HIGHLIGHT_DEBOUNCE_MS);
    expect(highlighted(parent)).toEqual(["TODO", "TODO"]);

    editor.configure(config({ settings: {} }));
    expect(highlighted(parent)).toEqual([]);
  });

  it("puts a highlight rule's mark inside the live-preview styling so its colour wins", () => {
    const { parent } = mount("Some **TODO** here\n");
    const mark = parent.querySelector("[class*='bb-notes-hl-']");
    expect(mark?.closest(".cm-line")).not.toBeNull();
    expect(mark?.textContent).toBe("TODO");
    expect(mark?.children.length).toBe(0);
    expect(mark?.parentElement?.closest(".cm-line")).not.toBeNull();
    expect(mark?.parentElement?.classList.contains("cm-line")).toBe(false);
  });

  it("scrolls to a TOC anchor and sends other links to the host", () => {
    const { editor, handlers, parent } = mount(
      "- [Two](#two)\n- [Site](https://bb.dev)\n\n## Two\n",
    );
    expect(editor.scrollToAnchor("two")).toBe(true);
    expect(editor.scrollToAnchor("missing")).toBe(false);

    const links = [...parent.querySelectorAll(".cm-lp-link")];
    expect(links.map((link) => link.getAttribute("data-href"))).toEqual([
      "#two",
      "https://bb.dev",
    ]);
    for (const link of links) {
      link.dispatchEvent(mouse("mousedown"));
      link.dispatchEvent(mouse("mouseup"));
    }
    expect(handlers.openUrl).toHaveBeenCalledTimes(1);
    expect(handlers.openUrl).toHaveBeenCalledWith("https://bb.dev");
  });

  it("inserts a table of contents as one undoable step", () => {
    const { editor } = mount("## One\n");
    expect(editor.insertToc(false)).toBe("inserted");
    expect(editor.view.state.doc.toString()).toBe(
      "<!-- toc -->\n- [One](#one)\n<!-- /toc -->\n## One\n",
    );
    expect(editor.insertToc(false)).toBe("updated");
  });

  it("gives every note its own undo history", () => {
    const first = mount("one");
    typeAt(first.editor.view, 3, "!");
    const second = mount("two");
    expect(undoDepth(first.editor.view.state)).toBe(1);
    expect(undoDepth(second.editor.view.state)).toBe(0);
  });
});

function press(
  view: EditorView,
  init: KeyboardEventInit & { keyCode?: number },
): boolean {
  return runScopeHandlers(
    view,
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
    "editor",
  );
}

function styleRuleCount(): number {
  const sheet = document.getElementById("bb-plugin-notes-highlight-styles");
  return (sheet?.textContent ?? "").split("\n").filter((rule) => rule !== "")
    .length;
}

describe("reloading from disk", () => {
  it("starts a fresh undo history so undo cannot replay discarded edits", () => {
    const { editor, handlers } = mount("one\n");
    const view = editor.view;
    typeAt(view, 3, " mine");
    editor.replaceContent("one theirs\n");
    expect(undoDepth(view.state)).toBe(0);
    expect(undo(view)).toBe(false);
    expect(view.state.doc.toString()).toBe("one theirs\n");
    expect(handlers.onChange).toHaveBeenCalledTimes(1);
  });

  it("does not duplicate lines when undo follows a reload", () => {
    const { editor } = mount("alpha\nbeta\ngamma\n");
    const view = editor.view;
    view.dispatch({
      changes: { from: 6, to: 11 },
      userEvent: "delete",
    });
    editor.replaceContent("alpha\nbeta\ngamma\ndelta\n");
    undo(view);
    expect(view.state.doc.toString()).toBe("alpha\nbeta\ngamma\ndelta\n");
  });

  it("keeps the current settings and the cursor after a reload", () => {
    const { editor, parent } = mount("TODO one\n");
    editor.configure(
      config({ settings: { ...RULES, "editor.lineNumbers": "on" } }),
    );
    editor.view.dispatch({ selection: EditorSelection.cursor(4) });
    editor.replaceContent("TODO one\nTODO two\n");
    expect(parent.querySelector(".cm-lineNumbers")).not.toBeNull();
    expect(highlighted(parent)).toEqual(["TODO", "TODO"]);
    expect(editor.view.state.selection.main.head).toBe(4);
  });
});

describe("find and replace", () => {
  const NOTE = "---\nstatus: draft\n---\n\nSome draft body\n";

  it("reveals collapsed frontmatter while a search match sits inside it", () => {
    const { editor, parent } = mount(NOTE);
    const view = editor.view;
    openSearchPanel(view);
    view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({ search: "draft", replace: "final" }),
      ),
    });
    expect(parent.querySelector(".cm-lp-frontmatter-line")).toBeNull();

    expect(findNext(view)).toBe(true);
    expect(view.state.selection.main.from).toBe(NOTE.indexOf("draft"));
    expect(parent.querySelector(".cm-lp-frontmatter-line")).not.toBeNull();

    expect(replaceNext(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(
      "---\nstatus: final\n---\n\nSome draft body\n",
    );
  });

  it("stops revealing once focus leaves the search panel for the page", () => {
    const { editor, parent } = mount(NOTE);
    const view = editor.view;
    openSearchPanel(view);
    view.dispatch({
      effects: setSearchQuery.of(new SearchQuery({ search: "draft" })),
    });
    findNext(view);
    expect(previewValue(view.state).focused).toBe(true);
    const field = parent.querySelector(".cm-search input");
    if (field === null) throw new Error("no search field");
    field.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
    );
    expect(previewValue(view.state).focused).toBe(false);
    expect(parent.querySelector(".cm-lp-frontmatter-line")).toBeNull();
  });
});

describe("links", () => {
  const NOTE =
    "[Other](other.md) [Mail](mailto:me@x.com) [Old](#old)\n\n## New\n";

  function linkNamed(parent: HTMLElement, text: string): Element {
    const link = [...parent.querySelectorAll(".cm-lp-link")].find(
      (element) => element.textContent === text,
    );
    if (link === undefined) throw new Error(`no rendered link ${text}`);
    return link;
  }

  function clickLink(link: Element): void {
    link.dispatchEvent(mouse("mousedown"));
    link.dispatchEvent(mouse("mouseup"));
  }

  it("opens a relative Markdown link as a note beside the current one", () => {
    const { handlers, parent } = mount(NOTE);
    clickLink(linkNamed(parent, "Other"));
    expect(handlers.openNote).toHaveBeenCalledWith("work/other.md");
  });

  it("puts the cursor in a link the host cannot open, so it can be edited", () => {
    const { editor, handlers, parent } = mount(NOTE, {
      openUrl: () => false,
    });
    const view = editor.view;
    clickLink(linkNamed(parent, "Mail"));
    expect(handlers.openUrl).toHaveBeenCalledWith("mailto:me@x.com");
    const from = NOTE.indexOf("[Mail]");
    const head = view.state.selection.main.head;
    expect(head).toBeGreaterThanOrEqual(from);
    expect(head).toBeLessThanOrEqual(NOTE.indexOf(" [Old]"));
  });

  it("puts the cursor in a TOC link whose heading is gone", () => {
    const { editor, parent } = mount(NOTE);
    clickLink(linkNamed(parent, "Old"));
    const head = editor.view.state.selection.main.head;
    expect(head).toBeGreaterThanOrEqual(NOTE.indexOf("[Old]"));
    expect(head).toBeLessThanOrEqual(NOTE.indexOf("\n"));
  });
});

describe("keys", () => {
  it("accepts the open @ completion with Tab", async () => {
    const tags: WikiTagsSource = {
      call: async () => ({
        status: "ok",
        mtimeMs: 1,
        tags: [
          {
            tag: "adding-config-catalog",
            title: "Adding config catalog",
            type: "process",
            aliases: ["cc"],
          },
        ],
      }),
    };
    const { editor } = mount("", { wikiTags: tags });
    const view = editor.view;
    typeAt(view, 0, "see @cc");
    startCompletion(view);
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(press(view, { key: "Tab", keyCode: 9 })).toBe(true);
    expect(view.state.doc.toString()).toBe("see @adding-config-catalog");
  });

  it("deletes the line with Mod-Shift-K and opens a line below with Mod-Enter", () => {
    const { editor } = mount("one\ntwo\nthree");
    const view = editor.view;
    view.dispatch({ selection: EditorSelection.cursor(5) });
    expect(
      press(view, { key: "K", keyCode: 75, ctrlKey: true, shiftKey: true }),
    ).toBe(true);
    expect(view.state.doc.toString()).toBe("one\nthree");
    view.dispatch({ selection: EditorSelection.cursor(1) });
    expect(press(view, { key: "Enter", keyCode: 13, ctrlKey: true })).toBe(
      true,
    );
    expect(view.state.doc.toString()).toBe("one\n\nthree");
  });
});

describe("highlight styles", () => {
  it("keeps one stylesheet rule per style however many notes are opened", () => {
    for (let index = 0; index < 5; index += 1) {
      const { editor } = mount("TODO\n");
      editors.splice(editors.indexOf(editor), 1);
      editor.destroy();
    }
    expect(styleRuleCount()).toBe(1);
  });
});

describe("line numbers", () => {
  it("tags heading lines in the gutter so their numbers line up with the text", () => {
    const { parent } = mount("# Title\n\ntext\n\n## Part\n", {
      config: config({ settings: { "editor.lineNumbers": "on" } }),
    });
    expect(parent.querySelector(".cm-notes-gutter-h1")?.textContent).toBe("1");
    expect(parent.querySelector(".cm-notes-gutter-h2")?.textContent).toBe("5");
  });
});
