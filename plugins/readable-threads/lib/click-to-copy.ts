import { createCopyTip } from "./copy-tip.js";
import { MESSAGE_COLUMN_SELECTOR } from "./highlighter.js";
import { COPIED_HIGHLIGHT_NAME } from "./styles.js";

const FLASH_MS = 900;
const HINT_DELAY_MS = 400;

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
  const tip = createCopyTip(doc);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let hintTimer: ReturnType<typeof setTimeout> | null = null;
  let hovered: HTMLElement | null = null;
  let enabled = false;
  let disposed = false;

  const later = (run: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, ms);
    timers.add(timer);
    return timer;
  };

  const cancelHint = () => {
    if (hintTimer === null) return;
    clearTimeout(hintTimer);
    timers.delete(hintTimer);
    hintTimer = null;
  };

  const onPointerOver = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    const code = copyTargetFor(event.target);
    if (code === hovered) return;
    hovered = code;
    cancelHint();
    if (tip.anchor !== null && tip.anchor !== code) tip.hide();
    if (code === null) return;
    hintTimer = later(() => {
      hintTimer = null;
      if (hovered === code && code.isConnected) tip.show(code, "hint");
    }, HINT_DELAY_MS);
  };

  const onPointerOut = (event: PointerEvent) => {
    if (hovered === null) return;
    const next = event.relatedTarget;
    if (next instanceof Node && hovered.contains(next)) return;
    hovered = null;
    cancelHint();
    tip.hide();
  };

  const onScroll = () => {
    cancelHint();
    tip.hide();
  };

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
    cancelHint();
    void copy(text).then((copied) => {
      if (!copied || disposed || !code.isConnected) return;
      tip.show(code, "copied");
      later(() => {
        if (tip.anchor === code) tip.hide();
      }, FLASH_MS);
      if (flash === null) return;
      const range = doc.createRange();
      range.selectNodeContents(code);
      flash.add(range);
      later(() => flash.delete(range), FLASH_MS);
    });
  };

  const setEnabled = (next: boolean) => {
    if (disposed || next === enabled) return;
    enabled = next;
    if (enabled) {
      doc.addEventListener("click", onClick);
      doc.addEventListener("pointerover", onPointerOver);
      doc.addEventListener("pointerout", onPointerOut);
      doc.addEventListener("scroll", onScroll, {
        capture: true,
        passive: true,
      });
      return;
    }
    doc.removeEventListener("click", onClick);
    doc.removeEventListener("pointerover", onPointerOver);
    doc.removeEventListener("pointerout", onPointerOut);
    doc.removeEventListener("scroll", onScroll, { capture: true });
    hovered = null;
    cancelHint();
    tip.hide();
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
      tip.dispose();
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
