import { MESSAGE_COLUMN_SELECTOR } from "./highlighter.js";
import { COPIED_HIGHLIGHT_NAME } from "./styles.js";

const FLASH_MS = 900;

export type CopyText = (text: string) => Promise<boolean>;

export interface ClickToCopy {
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

export function copyTargetFor(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const code = target.closest("code");
  if (!(code instanceof HTMLElement)) return null;
  if (code.closest("pre, a, button, [contenteditable]") !== null) return null;
  if (code.closest(MESSAGE_COLUMN_SELECTOR) === null) return null;
  return code;
}

export function startClickToCopy(
  doc: Document,
  copy: CopyText,
  initiallyEnabled: boolean,
): ClickToCopy {
  const win = globalThis;
  const canFlash =
    typeof win.Highlight === "function" &&
    typeof win.CSS !== "undefined" &&
    "highlights" in win.CSS;
  const flash = canFlash ? new win.Highlight() : null;
  if (flash !== null) win.CSS.highlights.set(COPIED_HIGHLIGHT_NAME, flash);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let enabled = false;
  let disposed = false;

  const onClick = (event: MouseEvent) => {
    if (event.button !== 0 || event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    const code = copyTargetFor(event.target);
    if (code === null) return;
    const selection = doc.getSelection();
    if (selection !== null && !selection.isCollapsed) return;
    const text = code.textContent ?? "";
    if (text.length === 0) return;
    void copy(text).then((copied) => {
      if (!copied || disposed || flash === null || !code.isConnected) return;
      const range = doc.createRange();
      range.selectNodeContents(code);
      flash.add(range);
      const timer = setTimeout(() => {
        timers.delete(timer);
        flash.delete(range);
      }, FLASH_MS);
      timers.add(timer);
    });
  };

  const setEnabled = (next: boolean) => {
    if (disposed || next === enabled) return;
    enabled = next;
    if (enabled) doc.addEventListener("click", onClick);
    else doc.removeEventListener("click", onClick);
  };

  setEnabled(initiallyEnabled);

  return {
    setEnabled,
    dispose() {
      if (disposed) return;
      setEnabled(false);
      disposed = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      flash?.clear();
      if (
        flash !== null &&
        win.CSS.highlights.get(COPIED_HIGHLIGHT_NAME) === flash
      ) {
        win.CSS.highlights.delete(COPIED_HIGHLIGHT_NAME);
      }
    },
  };
}
