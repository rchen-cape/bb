import type { Preview, PruneResult, Status } from "./contract.js";
import { DIALOG_ATTRIBUTE, DIALOG_STYLES } from "./dialog.js";

export const HEADER_SELECTOR = '[data-testid="nav-rail-header"]';
const BUTTON_ATTRIBUTE = "data-prune-threads-button";
const STYLE_ATTRIBUTE = "data-prune-threads-styles";
const STATUS_RESET_MS = 2500;
export const POLL_MS = 60_000;
const BUTTON_STYLES = `
${HEADER_SELECTOR}:has([${BUTTON_ATTRIBUTE}]) > button:not([${BUTTON_ATTRIBUTE}]) {
  flex: 1 0 auto;
}
[${BUTTON_ATTRIBUTE}] {
  min-width: 0;
  padding-inline: 0.375rem;
}
[${BUTTON_ATTRIBUTE}] > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[${BUTTON_ATTRIBUTE}][data-state="hidden"] {
  display: none;
}
[${BUTTON_ATTRIBUTE}]:disabled {
  opacity: 0.5;
  cursor: default;
}
`;

export interface PruneButtonDeps {
  status(): Promise<Status>;
  preview(): Promise<Preview>;
  choose(preview: Preview): Promise<string[] | null>;
  prune(rootIds: string[]): Promise<PruneResult>;
  alert(message: string): void;
}

function plural(count: number) {
  return `${count} thread${count === 1 ? "" : "s"}`;
}

export function mountPruneButton(doc: Document, deps: PruneButtonDeps) {
  const style = doc.createElement("style");
  style.setAttribute(STYLE_ATTRIBUTE, "");
  style.textContent = `${BUTTON_STYLES}\n${DIALOG_STYLES}`;
  doc.head.append(style);

  let threadCount: number | null | undefined = undefined;
  let busyText: string | null = null;
  let flashText: string | null = null;
  let flashTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const buttons = () =>
    doc.querySelectorAll<HTMLButtonElement>(`[${BUTTON_ATTRIBUTE}]`);

  const paint = (button: HTMLButtonElement) => {
    const hidden =
      busyText === null &&
      flashText === null &&
      (threadCount === undefined || threadCount === 0);
    const label =
      button.querySelector("span") ??
      button.appendChild(doc.createElement("span"));
    label.textContent = busyText ?? flashText ?? "Prune";
    button.disabled = busyText !== null;
    button.dataset.state = hidden ? "hidden" : "ready";
    button.title =
      typeof threadCount === "number"
        ? `${plural(threadCount)} can be pruned`
        : "Delete read, finished threads idle over 24 hours with nothing left to push";
  };
  const render = () => {
    for (const button of buttons()) paint(button);
  };

  const flash = (text: string) => {
    if (flashTimer !== null) clearTimeout(flashTimer);
    flashText = text;
    render();
    flashTimer = setTimeout(() => {
      flashTimer = null;
      flashText = null;
      render();
    }, STATUS_RESET_MS);
  };

  const checkStatus = async () => {
    try {
      const status = await deps.status();
      if (disposed) return;
      threadCount = status.threadCount;
    } catch {
      if (disposed) return;
      threadCount = null;
    }
    render();
  };

  const onClick = async () => {
    if (busyText !== null) return;
    busyText = "Checking…";
    render();
    try {
      const preview = await deps.preview();
      threadCount = preview.groups.reduce(
        (total, group) => total + group.threadIds.length,
        0,
      );
      if (preview.groups.length === 0) {
        busyText = null;
        render();
        return;
      }
      busyText = "Prune";
      render();
      const rootIds = await deps.choose(preview);
      if (rootIds === null || rootIds.length === 0) {
        busyText = null;
        render();
        return;
      }
      busyText = "Pruning…";
      render();
      const result = await deps.prune(rootIds);
      busyText = null;
      flash(`Pruned ${result.deletedThreadIds.length}`);
      void checkStatus();
      if (result.failed.length > 0)
        deps.alert(
          `Could not delete ${plural(result.failed.length)}:\n\n${result.failed
            .map((entry) => `• ${entry.threadId}: ${entry.message}`)
            .join("\n")}`,
        );
    } catch (error) {
      busyText = null;
      render();
      deps.alert(
        `Prune failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const createButton = (header: Element) => {
    const button = doc.createElement("button");
    button.type = "button";
    button.setAttribute(BUTTON_ATTRIBUTE, "");
    const sibling = header.querySelector("button");
    if (sibling !== null) {
      button.className = sibling.className;
      button.classList.remove("flex-1", "w-auto");
    }
    button.classList.add("w-auto");
    button.addEventListener("click", () => void onClick());
    paint(button);
    return button;
  };

  const ensure = () => {
    for (const header of doc.querySelectorAll(HEADER_SELECTOR)) {
      if (header.querySelector(`[${BUTTON_ATTRIBUTE}]`) !== null) continue;
      header.append(createButton(header));
    }
  };
  ensure();
  const observer = new MutationObserver(ensure);
  observer.observe(doc.body, { childList: true, subtree: true });

  const onVisible = () => {
    if (doc.visibilityState === "visible") void checkStatus();
  };
  doc.addEventListener("visibilitychange", onVisible);
  const poll = setInterval(onVisible, POLL_MS);
  void checkStatus();

  return () => {
    disposed = true;
    observer.disconnect();
    clearInterval(poll);
    if (flashTimer !== null) clearTimeout(flashTimer);
    doc.removeEventListener("visibilitychange", onVisible);
    style.remove();
    for (const node of doc.querySelectorAll(
      `[${BUTTON_ATTRIBUTE}], [${DIALOG_ATTRIBUTE}-backdrop]`,
    ))
      node.remove();
  };
}
