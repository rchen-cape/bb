// @vitest-environment jsdom
import { undo, undoDepth } from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import {
  loadPluginApp,
  renderSlot,
  type PluginRpcTestHandlers,
} from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installDomPolyfills } from "./lib/live-preview/test-dom.js";
import type { rpcContract } from "./server.js";

installDomPolyfills();

const app = await loadPluginApp(() => import("./app.js"));
const panel = app.navPanels[0];

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

type Contract = typeof rpcContract;
type Handlers = PluginRpcTestHandlers<Contract>;
type ReadResult = Awaited<ReturnType<Handlers["read"]>>;
type WriteResult = Awaited<ReturnType<Handlers["write"]>>;

const NOTE = "# Plan\n\n## First\n\nSome text\n";

function handlers(overrides: Partial<Handlers> = {}): Handlers {
  return {
    settings: () => ({ root: "/notes", settings: {}, overridePath: null }),
    tree: () => ({
      root: "/notes",
      entries: [
        { path: "work", kind: "directory" },
        { path: "work/plan.md", kind: "file" },
        { path: "work/other.md", kind: "file" },
      ],
      truncated: false,
    }),
    read: ({ path }): ReadResult => ({
      kind: "text",
      content: NOTE,
      sha256: "sha-read",
      path,
    }),
    write: (): WriteResult => ({ outcome: "written", sha256: "sha-next" }),
    createFile: ({ path }) => ({ path, sha256: "sha-new" }),
    createDirectory: ({ path }) => ({ path }),
    rename: ({ to }) => ({ path: to }),
    remove: ({ path }) => ({ path }),
    wikiTags: () => ({ status: "off" }),
    ...overrides,
  };
}

function open(rpc: Handlers, subPath = "work/plan.md") {
  if (panel === undefined) throw new Error("Notes registers no panel");
  return renderSlot<PluginNavPanelProps, Contract>(panel, { subPath }, { rpc });
}

async function editorIn(
  slot: ReturnType<typeof open>,
  path = "work/plan.md",
): Promise<EditorView> {
  const content = await slot.findByRole("textbox", { name: `Note ${path}` });
  const view = EditorView.findFromDOM(content);
  if (view === null) throw new Error("no editor view");
  await waitFor(() => expect(slot.queryByText("Opening note…")).toBeNull());
  return view;
}

function typeAtEnd(view: EditorView, text: string): void {
  const end = view.state.doc.length;
  act(() => {
    view.dispatch({
      changes: { from: end, insert: text },
      selection: EditorSelection.cursor(end + text.length),
      userEvent: "input.type",
    });
  });
}

function click(element: Element): void {
  for (const type of ["mousedown", "mouseup"]) {
    act(() => {
      element.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: type === "mousedown" ? 1 : 0,
        }),
      );
    });
  }
}

function pressSave(): void {
  fireEvent.keyDown(window, { key: "s", metaKey: true });
}

describe("Notes panel", () => {
  it("opens the note in the live-preview editor and saves edits on Cmd+S", async () => {
    const write = vi.fn((): WriteResult => ({
      outcome: "written",
      sha256: "sha-next",
    }));
    const slot = open(handlers({ write }));
    const view = await editorIn(slot);
    expect(view.state.doc.toString()).toBe(NOTE);
    expect(view.dom.querySelector(".cm-lp-h1")).not.toBeNull();

    typeAtEnd(view, "More\n");
    pressSave();

    await waitFor(() =>
      expect(write).toHaveBeenCalledWith({
        path: "work/plan.md",
        content: `${NOTE}More\n`,
        expectedSha256: "sha-read",
      }),
    );
  });

  it("shows the conflict banner and reloads the file from disk", async () => {
    let content = NOTE;
    const slot = open(
      handlers({
        read: ({ path }): ReadResult => ({
          kind: "text",
          content,
          sha256: "sha-read",
          path,
        }),
        write: (): WriteResult => ({
          outcome: "conflict",
          currentSha256: "sha-disk",
        }),
      }),
    );
    const view = await editorIn(slot);
    typeAtEnd(view, "mine");
    pressSave();
    await slot.findByText("This note changed on disk since you opened it.");

    content = "# From disk\n";
    fireEvent.click(slot.getByRole("button", { name: "Reload" }));
    await waitFor(() =>
      expect(view.state.doc.toString()).toBe("# From disk\n"),
    );
    await waitFor(() =>
      expect(
        slot.queryByText("This note changed on disk since you opened it."),
      ).toBeNull(),
    );
    expect(undoDepth(view.state)).toBe(0);
    act(() => {
      undo(view);
    });
    expect(view.state.doc.toString()).toBe("# From disk\n");
  });

  it("opens a relative link to another note in the panel", async () => {
    const slot = open(
      handlers({
        read: ({ path }): ReadResult => ({
          kind: "text",
          content: "See [Other](other.md) and [Gone](gone.md)\n",
          sha256: "sha-read",
          path,
        }),
      }),
    );
    const view = await editorIn(slot);
    await waitFor(() => expect(slot.queryByText("other.md")).not.toBeNull());
    const [other, gone] = [...view.dom.querySelectorAll(".cm-lp-link")];
    if (other === undefined || gone === undefined) {
      throw new Error("expected two rendered links");
    }
    click(other);
    await waitFor(() =>
      expect(slot.navigateCalls).toContainEqual({
        method: "toPluginPanel",
        path: "notes",
        options: { subPath: "work/other.md" },
      }),
    );

    click(gone);
    const text = view.state.doc.toString();
    const at = view.state.selection.main.head;
    expect(at).toBeGreaterThanOrEqual(text.indexOf("[Gone]"));
    expect(at).toBeLessThanOrEqual(text.indexOf("\n"));
    expect(
      slot.navigateCalls.filter((call) => call.method === "toPluginPanel"),
    ).toHaveLength(1);
  });

  it("inserts a table of contents from the toolbar", async () => {
    const slot = open(handlers());
    const view = await editorIn(slot);
    fireEvent.click(
      slot.getByRole("button", { name: "Insert or refresh table of contents" }),
    );
    expect(view.state.doc.toString()).toBe(
      `<!-- toc -->\n- [First](#first)\n<!-- /toc -->\n${NOTE}`,
    );
  });

  it("applies line numbers and word wrap from the settings file", async () => {
    const slot = open(
      handlers({
        settings: () => ({
          root: "/notes",
          settings: { "editor.lineNumbers": "on", "editor.wordWrap": "off" },
          overridePath: ".vscode/settings.json",
        }),
      }),
    );
    const view = await editorIn(slot);
    await waitFor(() =>
      expect(view.dom.querySelector(".cm-lineNumbers")).not.toBeNull(),
    );
    expect(view.contentDOM.classList.contains("cm-lineWrapping")).toBe(false);
    fireEvent.click(slot.getByRole("button", { name: "Turn on word wrap" }));
    expect(view.contentDOM.classList.contains("cm-lineWrapping")).toBe(true);
  });

  it("explains why a file cannot be opened", async () => {
    const slot = open(
      handlers({
        read: (): ReadResult => ({
          kind: "unsupported",
          reason: "Notes only opens Markdown files",
        }),
      }),
    );
    await slot.findByText("Notes only opens Markdown files");
    expect(slot.queryByRole("textbox", { name: /^Note / })).toBeNull();
  });

  it("asks before leaving a note whose changes could not be saved", async () => {
    const slot = open(
      handlers({
        write: () => {
          throw new Error("disk full");
        },
      }),
    );
    const view = await editorIn(slot);
    typeAtEnd(view, "unsaved");
    fireEvent.click(await slot.findByText("other.md"));
    await slot.findByText("Discard unsaved changes?");
    expect(
      slot.navigateCalls.some((call) => call.method === "toPluginPanel"),
    ).toBe(false);
    fireEvent.click(slot.getByRole("button", { name: "Discard and open" }));
    await waitFor(() =>
      expect(slot.navigateCalls).toContainEqual(
        expect.objectContaining({ method: "toPluginPanel" }),
      ),
    );
  });

  it("gives the next note a fresh editor and undo history", async () => {
    const slot = open(handlers());
    const first = await editorIn(slot);
    typeAtEnd(first, "edit");
    if (panel === undefined) throw new Error("Notes registers no panel");
    const Panel = panel.component;
    slot.rerender(<Panel subPath="work/other.md" />);
    const second = await editorIn(slot, "work/other.md");
    expect(second).not.toBe(first);
    expect(second.state.doc.toString()).toBe(NOTE);
    expect(undoDepth(first.state)).toBe(1);
    expect(undoDepth(second.state)).toBe(0);
  });
});
