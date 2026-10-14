// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { IMarker, Terminal as XTermTerminal } from "@xterm/xterm";
import type { TrackedTerminalCommandBlock } from "./terminal-command-block-tracker";
import {
  registerTerminalCommandBlockAction,
  TERMINAL_COMMAND_GUTTER_INSET_PX,
  TERMINAL_COMMAND_GUTTER_WIDTH_PX,
} from "./terminal-command-block-decoration";

function createMarker(line: number): IMarker {
  return {
    dispose: () => {},
    isDisposed: false,
    line,
    onDispose: () => ({ dispose: () => {} }),
  } as unknown as IMarker;
}

function createBlock(): TrackedTerminalCommandBlock {
  return {
    command: "ls -la",
    cwd: "/tmp",
    exitCode: 0,
    id: 1,
    outputEndCursorX: 0,
    outputEndMarker: createMarker(3),
    outputStartMarker: createMarker(1),
    promptMarker: createMarker(0),
    running: false,
  };
}

interface RenderedDecoration {
  activated: TrackedTerminalCommandBlock[];
  element: HTMLElement;
  rerender: () => void;
}

function renderDecoration(
  block: TrackedTerminalCommandBlock,
): RenderedDecoration {
  const renderListeners: ((element: HTMLElement) => void)[] = [];
  const terminal = {
    cols: 80,
    registerDecoration: () => ({
      dispose: () => {},
      onRender: (listener: (element: HTMLElement) => void) => {
        renderListeners.push(listener);
        return { dispose: () => {} };
      },
    }),
  } as unknown as XTermTerminal;
  const activated: TrackedTerminalCommandBlock[] = [];
  registerTerminalCommandBlockAction({
    block,
    onActivate: (activatedBlock) => activated.push(activatedBlock),
    terminal,
  });
  const element = document.createElement("div");
  const rerender = () => {
    for (const listener of renderListeners) {
      listener(element);
    }
  };
  rerender();
  return { activated, element, rerender };
}

describe("registerTerminalCommandBlockAction", () => {
  it("places the action in the gutter left of the terminal text", () => {
    const { element } = renderDecoration(createBlock());
    const button = element.querySelector("button");

    expect(button).not.toBeNull();
    expect(button?.style.left).toBe(`-${TERMINAL_COMMAND_GUTTER_INSET_PX}px`);
    expect(button?.style.width).toBe(`${TERMINAL_COMMAND_GUTTER_WIDTH_PX}px`);
    expect(button?.getAttribute("aria-label")).toBe(
      'Add "ls -la" and its output to chat',
    );
  });

  it("renders the action once when the decoration re-renders", () => {
    const { element, rerender } = renderDecoration(createBlock());
    rerender();
    rerender();

    expect(element.querySelectorAll("button")).toHaveLength(1);
  });

  it("activates the block when the action is clicked", () => {
    const block = createBlock();
    const { activated, element } = renderDecoration(block);
    element.querySelector("button")?.click();

    expect(activated).toEqual([block]);
  });
});
