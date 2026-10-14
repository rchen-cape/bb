import type { IDisposable, Terminal as XTermTerminal } from "@xterm/xterm";
import type { TrackedTerminalCommandBlock } from "./terminal-command-block-tracker";

const DECORATION_RENDERED_FLAG = "bbCommandBlockRendered";

export const TERMINAL_COMMAND_GUTTER_WIDTH_PX = 18;
export const TERMINAL_COMMAND_GUTTER_GAP_PX = 4;
export const TERMINAL_COMMAND_GUTTER_INSET_PX =
  TERMINAL_COMMAND_GUTTER_WIDTH_PX + TERMINAL_COMMAND_GUTTER_GAP_PX;

export interface RegisterTerminalCommandBlockActionArgs {
  block: TrackedTerminalCommandBlock;
  onActivate: (block: TrackedTerminalCommandBlock) => void;
  terminal: XTermTerminal;
}

export function terminalCommandBlockActionTitle(
  block: TrackedTerminalCommandBlock,
): string {
  const exit =
    block.exitCode === null || block.exitCode === 0
      ? ""
      : ` (exit ${block.exitCode})`;
  return `Add "${block.command}"${exit} and its output to chat`;
}

function buildPlusIcon(): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 10 10");
  svg.setAttribute("width", "10");
  svg.setAttribute("height", "10");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const points of ["M5 1.5V8.5", "M1.5 5H8.5"]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", points);
    svg.append(path);
  }
  return svg;
}

function buildActionElement(
  args: RegisterTerminalCommandBlockActionArgs,
): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className =
    "pointer-events-auto absolute top-0 flex h-full items-center justify-center rounded-sm text-muted-foreground opacity-50 transition-[opacity,color,background-color] hover:bg-muted hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
  button.style.left = `-${TERMINAL_COMMAND_GUTTER_INSET_PX}px`;
  button.style.width = `${TERMINAL_COMMAND_GUTTER_WIDTH_PX}px`;
  button.title = terminalCommandBlockActionTitle(args.block);
  button.setAttribute(
    "aria-label",
    terminalCommandBlockActionTitle(args.block),
  );
  button.append(buildPlusIcon());
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    args.onActivate(args.block);
  });
  return button;
}

export function registerTerminalCommandBlockAction(
  args: RegisterTerminalCommandBlockActionArgs,
): IDisposable | null {
  const decoration = args.terminal.registerDecoration({
    height: 1,
    marker: args.block.promptMarker,
    width: args.terminal.cols,
    x: 0,
  });
  if (decoration === undefined) {
    return null;
  }
  decoration.onRender((element) => {
    if (element.dataset[DECORATION_RENDERED_FLAG] === "true") {
      return;
    }
    element.dataset[DECORATION_RENDERED_FLAG] = "true";
    element.classList.add("pointer-events-none", "relative");
    element.append(buildActionElement(args));
  });
  return decoration;
}
