// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mountPruneButton,
  POLL_MS,
  type PruneButtonDeps,
} from "./lib/button.js";
import type { Preview } from "./lib/contract.js";

const preview: Preview = {
  groups: [
    {
      rootId: "thr_1",
      title: "First",
      projectName: "bb",
      branchName: null,
      lastActiveAt: 0,
      threadIds: ["thr_1"],
    },
    {
      rootId: "thr_2",
      title: "Second",
      projectName: "bb",
      branchName: null,
      lastActiveAt: 0,
      threadIds: ["thr_2"],
    },
  ],
};

function deps(overrides: Partial<PruneButtonDeps> = {}): PruneButtonDeps {
  return {
    status: vi.fn(async () => ({ threadCount: 2, checkedAt: 0 })),
    preview: vi.fn(async () => preview),
    choose: vi.fn(async () => ["thr_2"]),
    prune: vi.fn(async (rootIds: string[]) => ({
      deletedThreadIds: rootIds,
      failed: [],
    })),
    alert: vi.fn(),
    ...overrides,
  };
}

function renderHeader() {
  document.body.innerHTML =
    '<div data-testid="nav-rail-header"><button class="flex-1 w-auto h-7">New thread</button></div>';
}

const pruneButton = () =>
  document.querySelector<HTMLButtonElement>("[data-prune-threads-button]")!;

const isHidden = () => pruneButton().dataset.state === "hidden";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("mountPruneButton", () => {
  it("adds one Prune button after New thread, matching its style", async () => {
    renderHeader();
    dispose = mountPruneButton(document, deps());
    await flush();
    const button = pruneButton();
    expect(button.textContent).toBe("Prune");
    expect(button.disabled).toBe(false);
    expect(button.title).toBe("2 threads can be pruned");
    expect(button.previousElementSibling?.textContent).toBe("New thread");
    expect(button.classList.contains("h-7")).toBe(true);
    expect(button.classList.contains("flex-1")).toBe(false);
  });

  it("hides until the first count arrives, then stays hidden at zero", async () => {
    renderHeader();
    dispose = mountPruneButton(
      document,
      deps({ status: vi.fn(async () => ({ threadCount: 0, checkedAt: 0 })) }),
    );
    expect(isHidden()).toBe(true);
    await flush();
    expect(isHidden()).toBe(true);
  });

  it("stays clickable when the count cannot be read", async () => {
    renderHeader();
    dispose = mountPruneButton(
      document,
      deps({
        status: vi.fn(async () => {
          throw new Error("offline");
        }),
      }),
    );
    await flush();
    expect(isHidden()).toBe(false);
    expect(pruneButton().textContent).toBe("Prune");
    expect(pruneButton().disabled).toBe(false);
  });

  it("re-checks every minute and when the window becomes visible", async () => {
    vi.useFakeTimers();
    renderHeader();
    let threadCount = 0;
    const status = vi.fn(async () => ({ threadCount, checkedAt: 0 }));
    dispose = mountPruneButton(document, deps({ status }));
    await vi.advanceTimersByTimeAsync(0);
    expect(isHidden()).toBe(true);

    threadCount = 3;
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(isHidden()).toBe(false);
    expect(pruneButton().disabled).toBe(false);

    threadCount = 0;
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(isHidden()).toBe(true);
    expect(status).toHaveBeenCalledTimes(3);
  });

  it("re-adds the button with the current state when the header re-renders", async () => {
    renderHeader();
    dispose = mountPruneButton(
      document,
      deps({ status: vi.fn(async () => ({ threadCount: 0, checkedAt: 0 })) }),
    );
    await flush();
    renderHeader();
    await flush();
    expect(
      document.querySelectorAll("[data-prune-threads-button]"),
    ).toHaveLength(1);
    expect(isHidden()).toBe(true);
  });

  it("deletes nothing when the dialog is cancelled", async () => {
    renderHeader();
    const cancelled = deps({ choose: vi.fn(async () => null) });
    dispose = mountPruneButton(document, cancelled);
    await flush();
    pruneButton().click();
    await flush();
    expect(cancelled.choose).toHaveBeenCalledWith(preview);
    expect(cancelled.prune).not.toHaveBeenCalled();
    expect(pruneButton().textContent).toBe("Prune");
  });

  it("deletes only the threads left checked, then re-checks the count", async () => {
    renderHeader();
    const accepted = deps();
    dispose = mountPruneButton(document, accepted);
    await flush();
    pruneButton().click();
    await flush();
    expect(accepted.prune).toHaveBeenCalledWith(["thr_2"]);
    expect(pruneButton().textContent).toBe("Pruned 1");
    expect(accepted.status).toHaveBeenCalledTimes(2);
    expect(accepted.alert).not.toHaveBeenCalled();
  });

  it("hides when a fresh check finds nothing", async () => {
    renderHeader();
    const empty = deps({ preview: vi.fn(async () => ({ groups: [] })) });
    dispose = mountPruneButton(document, empty);
    await flush();
    pruneButton().click();
    await flush();
    expect(empty.choose).not.toHaveBeenCalled();
    expect(isHidden()).toBe(true);
  });

  it("shows the result after pruning the last threads, then hides", async () => {
    vi.useFakeTimers();
    renderHeader();
    let threadCount = 2;
    dispose = mountPruneButton(
      document,
      deps({ status: vi.fn(async () => ({ threadCount, checkedAt: 0 })) }),
    );
    await vi.advanceTimersByTimeAsync(0);
    threadCount = 0;
    pruneButton().click();
    await vi.advanceTimersByTimeAsync(0);
    expect(pruneButton().textContent).toBe("Pruned 1");
    expect(isHidden()).toBe(false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(isHidden()).toBe(true);
  });

  it("removes the button, its styles, and polling on dispose", async () => {
    vi.useFakeTimers();
    renderHeader();
    const status = vi.fn(async () => ({ threadCount: 1, checkedAt: 0 }));
    mountPruneButton(document, deps({ status }))();
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(document.querySelector("[data-prune-threads-button]")).toBeNull();
    expect(document.querySelector("[data-prune-threads-styles]")).toBeNull();
    expect(status).toHaveBeenCalledTimes(1);
  });
});
