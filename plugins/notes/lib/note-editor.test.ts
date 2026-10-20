import { history, undo, undoDepth } from "@codemirror/commands";
import {
  EditorSelection,
  EditorState,
  type StateCommand,
  type TransactionSpec,
} from "@codemirror/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteAutosave, type WriteOutcome } from "./autosave.js";
import { openDocument, type DocumentFormat } from "./live-preview/index.js";
import { markdownState } from "./live-preview/test-support.js";
import {
  fontSizeFor,
  headingGutterLines,
  headingPosition,
  lineNumbersFor,
  noteAutosaveDocument,
  relativeLineLabel,
  tocPlan,
} from "./note-editor.js";

class Session {
  state: EditorState;
  readonly format: DocumentFormat;

  constructor(content: string, selection = 0) {
    const opened = openDocument(content);
    this.format = opened.format;
    this.state = EditorState.create({
      doc: opened.text,
      selection: EditorSelection.single(selection),
      extensions: [history()],
    });
  }

  dispatch(spec: TransactionSpec): void {
    this.state = this.state.update(spec).state;
  }

  type(text: string): void {
    const at = this.state.selection.main.head;
    this.dispatch({
      changes: { from: at, insert: text },
      selection: EditorSelection.cursor(at + text.length),
      userEvent: "input.type",
    });
  }

  run(command: StateCommand): boolean {
    return command({
      state: this.state,
      dispatch: (transaction) => {
        this.state = transaction.state;
      },
    });
  }

  document() {
    return noteAutosaveDocument(
      () => this.state.doc,
      () => this.format,
    );
  }
}

describe("noteAutosaveDocument", () => {
  it("returns to the saved version id when undo restores the saved text", () => {
    const session = new Session("# Plan\n");
    const document = session.document();
    const saved = document.getAlternativeVersionId();
    session.type("more");
    expect(document.getAlternativeVersionId()).not.toBe(saved);
    session.run(undo);
    expect(document.getAlternativeVersionId()).toBe(saved);
    expect(document.getValue()).toBe("# Plan\n");
  });

  it("writes back the file's own line endings and BOM", () => {
    const content = "﻿# Plan\r\n\r\nline\r\n";
    const session = new Session(content);
    expect(session.state.doc.toString()).toBe("# Plan\n\nline\n");
    expect(session.document().getValue()).toBe(content);
  });

  it("lets autosave treat undo back to the saved text as clean, with no write", async () => {
    vi.useFakeTimers();
    const session = new Session("draft", 5);
    const write = vi.fn<
      (content: string, expected: string | null) => Promise<WriteOutcome>
    >(async () => ({ outcome: "written", sha256: "next" }));
    const states: string[] = [];
    const autosave = new NoteAutosave({
      document: session.document(),
      sha256: "read",
      write,
      onStateChange: (state) => states.push(state.kind),
    });

    session.type(" more");
    autosave.edited();
    session.run(undo);
    autosave.edited();
    await vi.advanceTimersByTimeAsync(2000);

    expect(autosave.current.kind).toBe("clean");
    expect(write).not.toHaveBeenCalled();
    expect(states).toEqual(["dirty", "clean"]);

    session.type("!");
    autosave.edited();
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledWith("draft!", "read");
  });
});

afterEach(() => {
  vi.useRealTimers();
});

const NOTE = [
  "# Plan",
  "",
  "<!-- toc -->",
  "- [Old](#old)",
  "<!-- /toc -->",
  "",
  "## First step",
  "",
  "## Second step",
  "",
].join("\n");

describe("tocPlan", () => {
  it("refreshes an existing block in one transaction that a single undo reverts", () => {
    const session = new Session(NOTE, NOTE.length);
    session.type("text");
    const before = session.state.doc.toString();
    const plan = tocPlan(session.state, false);
    expect(plan.outcome).toBe("updated");
    if (plan.spec === null) throw new Error("expected a change");
    session.dispatch(plan.spec);
    expect(session.state.doc.toString()).toContain(
      "<!-- toc -->\n- [First step](#first-step)\n- [Second step](#second-step)\n<!-- /toc -->",
    );
    expect(session.state.selection.main.head).toBe(session.state.doc.length);
    expect(undoDepth(session.state)).toBe(2);
    session.run(undo);
    expect(session.state.doc.toString()).toBe(before);
  });

  it("does nothing when the block is already current", () => {
    const session = new Session(NOTE);
    const first = tocPlan(session.state, true);
    if (first.spec === null) throw new Error("expected a change");
    session.dispatch(first.spec);
    expect(tocPlan(session.state, true)).toEqual({
      outcome: "updated",
      spec: null,
    });
  });

  it("inserts a numbered block at the selection as one undo step", () => {
    const doc = "## One\n\n## Two\n";
    const session = new Session(doc, 0);
    const plan = tocPlan(session.state, true);
    expect(plan.outcome).toBe("inserted");
    if (plan.spec === null) throw new Error("expected a change");
    session.dispatch(plan.spec);
    const block =
      "<!-- toc -->\n1. [One](#one)\n2. [Two](#two)\n<!-- /toc -->\n";
    expect(session.state.doc.toString()).toBe(block + doc);
    expect(session.state.selection.main.head).toBe(block.length);
    session.run(undo);
    expect(session.state.doc.toString()).toBe(doc);
  });

  it("inserts below the frontmatter when the cursor is at or inside it", () => {
    const frontmatter = "---\ntitle: Plan\n---\n";
    const body = "\n## One\n\n## Two\n";
    const block = "<!-- toc -->\n- [One](#one)\n- [Two](#two)\n<!-- /toc -->\n";
    for (const selection of [0, 6]) {
      const session = new Session(frontmatter + body, selection);
      const plan = tocPlan(session.state, false);
      if (plan.spec === null) throw new Error("expected a change");
      session.dispatch(plan.spec);
      expect(session.state.doc.toString()).toBe(frontmatter + block + body);
      expect(session.state.selection.main.head).toBe(
        frontmatter.length + block.length,
      );
    }
  });

  it("keeps the cursor position when it is below the frontmatter", () => {
    const doc = "---\ntitle: Plan\n---\n\n## One\n";
    const session = new Session(doc, doc.indexOf("## One"));
    const plan = tocPlan(session.state, false);
    if (plan.spec === null) throw new Error("expected a change");
    session.dispatch(plan.spec);
    expect(session.state.doc.toString()).toBe(
      "---\ntitle: Plan\n---\n\n<!-- toc -->\n- [One](#one)\n<!-- /toc -->\n## One\n",
    );
  });

  it("reports a note with no headings", () => {
    const session = new Session("just text\n```\n# not a heading\n```\n");
    expect(tocPlan(session.state, false)).toEqual({
      outcome: "no-headings",
      spec: null,
    });
  });
});

describe("headingPosition", () => {
  it("finds the heading a TOC anchor points at", () => {
    const { doc } = new Session(NOTE).state;
    expect(headingPosition(doc, "second-step")).toBe(
      NOTE.indexOf("## Second step"),
    );
    expect(headingPosition(doc, "First-Step")).toBe(
      NOTE.indexOf("## First step"),
    );
  });

  it("decodes the anchor and ignores headings inside code", () => {
    const text = "```\n# Plan B\n```\n\n# Plan B\n";
    const { doc } = new Session(text).state;
    expect(headingPosition(doc, "plan%2Db")).toBe(text.lastIndexOf("# Plan B"));
    expect(headingPosition(doc, "%E0%A4%A")).toBeNull();
    expect(headingPosition(doc, "missing")).toBeNull();
  });
});

describe("line numbers and font size", () => {
  it("labels lines relative to the cursor line, which keeps its own number", () => {
    const state = new Session("a\nb\nc\nd", 2).state;
    expect([1, 2, 3, 4].map((line) => relativeLineLabel(state, line))).toEqual([
      "1",
      "2",
      "1",
      "2",
    ]);
  });

  it("shows no gutter unless the settings turn line numbers on", () => {
    expect(lineNumbersFor({})).toEqual([]);
    expect(lineNumbersFor({ "editor.lineNumbers": "off" })).toEqual([]);
    expect(lineNumbersFor({ "editor.lineNumbers": "on" })).not.toEqual([]);
    expect(lineNumbersFor({ "editor.lineNumbers": "relative" })).not.toEqual(
      [],
    );
  });

  it("uses the settings font size only when it is set", () => {
    expect(fontSizeFor({})).toBeUndefined();
    expect(fontSizeFor({ "editor.fontSize": 15 })).toBe("15px");
  });
});

describe("headingGutterLines", () => {
  it("finds ATX and setext headings up to level 4, including nested ones", () => {
    const state = markdownState(
      [
        "---",
        "# yaml: comment",
        "---",
        "# One",
        "",
        "Two",
        "===",
        "",
        "> ### Quoted",
        "",
        "- #### Listed",
        "",
        "##### Five",
        "",
        "```",
        "# not a heading",
        "```",
      ].join("\n"),
    );
    expect(headingGutterLines(state)).toEqual([
      { line: 4, level: 1 },
      { line: 6, level: 1 },
      { line: 9, level: 3 },
      { line: 11, level: 4 },
    ]);
  });
});
