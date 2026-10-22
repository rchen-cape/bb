// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Preview, PreviewGroup } from "./lib/contract.js";
import { formatAgo, groupDetails, openPruneDialog } from "./lib/dialog.js";

const HOUR = 3_600_000;
const NOW = 1000 * HOUR;

function group(rootId: string, overrides: Partial<PreviewGroup> = {}) {
  return {
    rootId,
    title: `Thread ${rootId}`,
    projectName: "bb",
    branchName: "main",
    lastActiveAt: NOW - 30 * HOUR,
    threadIds: [rootId],
    ...overrides,
  } satisfies PreviewGroup;
}

const preview: Preview = {
  groups: [
    group("a"),
    group("b", { threadIds: ["b", "b1", "b2"] }),
    group("c"),
  ],
};

const query = <T extends Element>(selector: string) =>
  document.querySelector<T>(selector)!;
const rowBoxes = () => [
  ...document.querySelectorAll<HTMLInputElement>("[data-prune-root-id]"),
];
const selectAll = () =>
  query<HTMLInputElement>("[data-prune-dialog-toolbar] input");
const deleteButton = () =>
  query<HTMLButtonElement>("[data-prune-dialog] button[data-destructive]");

function toggle(box: HTMLInputElement) {
  box.click();
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("openPruneDialog", () => {
  it("lists every group checked, counting child threads in the button", () => {
    void openPruneDialog(document, preview, NOW);
    expect(rowBoxes().map((box) => box.checked)).toEqual([true, true, true]);
    expect(selectAll().checked).toBe(true);
    expect(deleteButton().textContent).toBe("Delete 5 threads");
    expect(query("[data-prune-dialog-count]").textContent).toBe(
      "3 of 3 selected",
    );
  });

  it("returns only the checked root IDs", async () => {
    const result = openPruneDialog(document, preview, NOW);
    toggle(rowBoxes()[1]!);
    expect(deleteButton().textContent).toBe("Delete 2 threads");
    expect(selectAll().indeterminate).toBe(true);
    deleteButton().click();
    expect(await result).toEqual(["a", "c"]);
    expect(document.querySelector("[data-prune-dialog]")).toBeNull();
  });

  it("disables Delete when everything is unchecked, and select all restores", () => {
    void openPruneDialog(document, preview, NOW);
    toggle(selectAll());
    expect(rowBoxes().every((box) => !box.checked)).toBe(true);
    expect(deleteButton().disabled).toBe(true);
    toggle(selectAll());
    expect(rowBoxes().every((box) => box.checked)).toBe(true);
    expect(deleteButton().disabled).toBe(false);
  });

  it.each([
    [
      "Cancel",
      () =>
        query<HTMLButtonElement>("[data-prune-dialog] footer button").click(),
    ],
    [
      "Escape",
      () =>
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        ),
    ],
    [
      "a backdrop click",
      () =>
        query("[data-prune-dialog-backdrop]").dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true }),
        ),
    ],
  ])("returns null on %s", async (_, dismiss) => {
    const result = openPruneDialog(document, preview, NOW);
    dismiss();
    expect(await result).toBeNull();
    expect(document.querySelector("[data-prune-dialog]")).toBeNull();
  });

  it("starts focus on Cancel and keeps Tab inside the dialog", () => {
    void openPruneDialog(document, preview, NOW);
    expect(document.activeElement?.textContent).toBe("Cancel");
    deleteButton().focus();
    const tab = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(selectAll());
  });
});

describe("groupDetails", () => {
  it("leads with age and child count, then project and branch", () => {
    expect(groupDetails(preview.groups[1]!, NOW)).toEqual([
      "Active 1d ago",
      "+2 child threads",
      "bb",
      "main",
    ]);
  });

  it("drops missing project and branch", () => {
    expect(
      groupDetails(group("x", { projectName: null, branchName: null }), NOW),
    ).toEqual(["Active 1d ago"]);
  });
});

describe("formatAgo", () => {
  it.each([
    [5 * 60_000, "5m ago"],
    [3 * HOUR, "3h ago"],
    [50 * HOUR, "2d ago"],
    [24 * 15 * HOUR, "2w ago"],
  ])("formats %i ms as %s", (elapsed, expected) => {
    expect(formatAgo(NOW - elapsed, NOW)).toBe(expected);
  });
});
