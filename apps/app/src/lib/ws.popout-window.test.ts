import { describe, expect, it, vi } from "vitest";
import { WebSocketManager } from "./ws";

vi.mock("./popout-window", () => ({ isPopoutWindow: () => true }));

describe("WebSocketManager in a pop-out window", () => {
  it("ignores thread-open signals and their files", () => {
    const manager = new WebSocketManager();
    const threadOpen = vi.fn();
    const changed = vi.fn();
    manager.onThreadOpen(threadOpen);
    manager.onChanged(changed);

    manager.handleIncomingMessage(
      JSON.stringify({
        type: "thread-open",
        projectId: "proj_1",
        threadId: "thr_1",
        split: "right",
        file: { source: "workspace", path: "src/index.ts", lineNumber: 7 },
      }),
    );

    expect(threadOpen).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    expect(manager.consumePendingOpenFile("thr_1")).toBeNull();
  });

  it("ignores thread pane actions", () => {
    const manager = new WebSocketManager();
    const paneAction = vi.fn();
    manager.onThreadPaneAction(paneAction);

    manager.handleIncomingMessage(
      JSON.stringify({
        type: "thread-pane-action",
        projectId: "proj_1",
        threadId: "thr_1",
        action: "spotlight",
      }),
    );

    expect(paneAction).not.toHaveBeenCalled();
  });

  it("still delivers other realtime messages", () => {
    const manager = new WebSocketManager();
    const changed = vi.fn();
    manager.onChanged(changed);

    manager.handleIncomingMessage(
      JSON.stringify({
        type: "changed",
        entity: "thread",
        id: "thr_1",
        changes: ["events-appended"],
      }),
    );

    expect(changed).toHaveBeenCalledTimes(1);
  });
});
