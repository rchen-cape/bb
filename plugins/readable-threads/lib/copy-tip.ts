export const COPY_TIP_ATTRIBUTE = "data-readable-threads-copy-tip";
const GAP_PX = 6;
const MIN_TOP_PX = 32;

export type CopyTipState = "hint" | "copied";

export interface CopyTip {
  show(anchor: HTMLElement, state: CopyTipState): void;
  hide(): void;
  readonly anchor: HTMLElement | null;
  dispose(): void;
}

export function createCopyTip(doc: Document): CopyTip {
  let element: HTMLElement | null = null;
  let anchor: HTMLElement | null = null;

  const ensure = () => {
    if (element !== null && element.isConnected) return element;
    element = doc.createElement("div");
    element.setAttribute(COPY_TIP_ATTRIBUTE, "");
    element.setAttribute("role", "status");
    element.setAttribute("aria-live", "polite");
    doc.body.append(element);
    return element;
  };

  return {
    get anchor() {
      return anchor;
    },
    show(next, state) {
      const tip = ensure();
      anchor = next;
      const rect = next.getClientRects()[0] ?? next.getBoundingClientRect();
      const below = rect.top < MIN_TOP_PX;
      tip.textContent = state === "copied" ? "Copied" : "Click to copy";
      tip.dataset.state = state;
      tip.dataset.side = below ? "bottom" : "top";
      tip.style.left = `${rect.left + rect.width / 2}px`;
      tip.style.top = `${below ? rect.bottom + GAP_PX : rect.top - GAP_PX}px`;
      tip.dataset.visible = "";
    },
    hide() {
      anchor = null;
      if (element !== null) delete element.dataset.visible;
    },
    dispose() {
      anchor = null;
      element?.remove();
      element = null;
    },
  };
}
