// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { buildTree, type FlatEntry } from "../lib/notes-tree.js";
import { NotesSidebar } from "./NotesSidebar.js";

const ENTRIES: FlatEntry[] = [
  { path: "work", kind: "directory" },
  { path: "work/plan.md", kind: "file" },
  { path: "home", kind: "directory" },
  { path: "home/list.md", kind: "file" },
];

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function sidebar(
  entries: readonly FlatEntry[],
  options: {
    activePath?: string | null;
    onRename?: (from: string, to: string) => Promise<string | null>;
  } = {},
) {
  return (
    <NotesSidebar
      nodes={buildTree(entries)}
      activePath={options.activePath ?? null}
      isLoading={false}
      error={null}
      truncated={false}
      expandedFoldersKey="bb.notes-test.expanded-folders.v1"
      onOpen={() => {}}
      onCreate={() => {}}
      onRename={options.onRename ?? (async () => null)}
      onDelete={() => {}}
    />
  );
}

it("starts with folders closed and reopens only the ones left open after a remount", () => {
  const first = render(sidebar(ENTRIES));
  expect(screen.queryByText("plan.md")).toBeNull();
  expect(screen.queryByText("list.md")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "work" }));
  expect(screen.getByText("plan.md")).toBeTruthy();
  first.unmount();

  render(sidebar(ENTRIES));
  expect(screen.getByText("plan.md")).toBeTruthy();
  expect(screen.queryByText("list.md")).toBeNull();
});

it("opens just the folders above the open note", () => {
  render(sidebar(ENTRIES, { activePath: "home/list.md" }));

  expect(screen.getByText("list.md")).toBeTruthy();
  expect(screen.queryByText("plan.md")).toBeNull();
});

function renameFolder(name: string, to: string): void {
  const row = screen.getByRole("button", { name }).parentElement!;
  fireEvent.click(
    Array.from(row.querySelectorAll("button")).find(
      (button) => button.getAttribute("aria-label") === "Rename",
    )!,
  );
  const input = screen.getByRole("textbox", { name: `Rename ${name}` });
  fireEvent.change(input, { target: { value: to } });
  fireEvent.keyDown(input, { key: "Enter" });
}

it("keeps a renamed folder open once the rename lands", async () => {
  let finish: (path: string | null) => void = () => {};
  const onRename = vi.fn(
    () =>
      new Promise<string | null>((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(sidebar(ENTRIES, { onRename }));
  fireEvent.click(screen.getByRole("button", { name: "work" }));

  renameFolder("work", "projects");
  expect(onRename).toHaveBeenCalledWith("work", "projects");
  const renamed = ENTRIES.map((entry) => ({
    ...entry,
    path: entry.path.replace(/^work/, "projects"),
  }));
  view.rerender(sidebar(renamed, { onRename }));
  await act(async () => finish("projects"));

  expect(screen.getByText("plan.md")).toBeTruthy();
});

it("leaves folder state alone when a rename fails", async () => {
  render(sidebar(ENTRIES, { onRename: async () => null }));
  fireEvent.click(screen.getByRole("button", { name: "work" }));

  renameFolder("work", "home");
  await act(async () => {});

  expect(screen.getByText("plan.md")).toBeTruthy();
  expect(screen.queryByText("list.md")).toBeNull();
});
