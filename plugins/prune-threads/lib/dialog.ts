import type { Preview, PreviewGroup } from "./contract.js";

export const DIALOG_ATTRIBUTE = "data-prune-dialog";
const ROOT_ID_ATTRIBUTE = "data-prune-root-id";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export function formatAgo(at: number, now: number) {
  const elapsed = Math.max(0, now - at);
  if (elapsed < HOUR)
    return `${Math.max(1, Math.floor(elapsed / MINUTE))}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}d ago`;
  return `${Math.floor(elapsed / WEEK)}w ago`;
}

export function groupDetails(group: PreviewGroup, now: number) {
  const children = group.threadIds.length - 1;
  return [
    `Active ${formatAgo(group.lastActiveAt, now)}`,
    children > 0
      ? `+${children} child thread${children === 1 ? "" : "s"}`
      : null,
    group.projectName,
    group.branchName,
  ].filter((part): part is string => part !== null && part.length > 0);
}

export const DIALOG_STYLES = `
[${DIALOG_ATTRIBUTE}-backdrop] {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: color-mix(in oklab, var(--canvas) 55%, transparent);
  backdrop-filter: blur(2px);
}
[${DIALOG_ATTRIBUTE}] {
  display: flex;
  flex-direction: column;
  width: min(36rem, 100%);
  max-height: min(42rem, calc(100vh - 2rem));
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--popover);
  color: var(--popover-foreground);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  line-height: var(--text-sm--line-height, 1.25rem);
  box-shadow: 0 1.5rem 3rem -1rem color-mix(in oklab, var(--ink) 35%, transparent);
  overflow: hidden;
}
[${DIALOG_ATTRIBUTE}] :where(h2) {
  margin: 0;
  font-size: var(--text-base);
  font-weight: 600;
}
[${DIALOG_ATTRIBUTE}] :where(header) {
  display: grid;
  gap: 0.375rem;
  padding: 1.25rem 1.25rem 0.75rem;
}
[${DIALOG_ATTRIBUTE}] :where(header p) {
  margin: 0;
  color: var(--muted-foreground);
}
[${DIALOG_ATTRIBUTE}] :where(input[type="checkbox"]) {
  flex: none;
  width: 1rem;
  height: 1rem;
  margin: 0.125rem 0 0;
  accent-color: var(--destructive);
  cursor: pointer;
}
[${DIALOG_ATTRIBUTE}-toolbar] {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 1.25rem;
  border-block: 1px solid var(--border-seam);
  color: var(--muted-foreground);
  font-size: var(--text-xs);
}
[${DIALOG_ATTRIBUTE}-toolbar] :where(label) {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  color: var(--popover-foreground);
  font-size: var(--text-sm);
  cursor: pointer;
}
[${DIALOG_ATTRIBUTE}-toolbar] :where(label input) {
  margin: 0;
}
[${DIALOG_ATTRIBUTE}-count] {
  margin-left: auto;
}
[${DIALOG_ATTRIBUTE}-list] {
  flex: 1 1 auto;
  min-height: 0;
  margin: 0;
  padding: 0.375rem 0.5rem;
  overflow-y: auto;
  overscroll-behavior: contain;
  list-style: none;
}
[${DIALOG_ATTRIBUTE}-list] :where(label) {
  display: flex;
  align-items: flex-start;
  gap: 0.625rem;
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-md);
  cursor: pointer;
}
[${DIALOG_ATTRIBUTE}-list] :where(label:hover) {
  background: var(--accent);
}
[${DIALOG_ATTRIBUTE}-list] :where(label:has(input:not(:checked))) [${DIALOG_ATTRIBUTE}-text] {
  opacity: 0.5;
}
[${DIALOG_ATTRIBUTE}-text] {
  display: grid;
  min-width: 0;
  gap: 0.125rem;
}
[${DIALOG_ATTRIBUTE}-title] {
  overflow: hidden;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[${DIALOG_ATTRIBUTE}-meta] {
  overflow: hidden;
  color: var(--muted-foreground);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
[${DIALOG_ATTRIBUTE}] :where(footer) {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 0.75rem 1.25rem 1rem;
  border-top: 1px solid var(--border-seam);
}
[${DIALOG_ATTRIBUTE}] :where(footer button) {
  height: 2rem;
  padding: 0 0.875rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 500;
  cursor: pointer;
}
[${DIALOG_ATTRIBUTE}] :where(footer button:hover) {
  background: var(--accent);
}
[${DIALOG_ATTRIBUTE}] :where(footer button[data-destructive]) {
  border-color: transparent;
  background: var(--destructive);
  color: var(--destructive-foreground);
}
[${DIALOG_ATTRIBUTE}] :where(footer button[data-destructive]:hover) {
  background: color-mix(in oklch, var(--destructive) 88%, var(--ink));
}
[${DIALOG_ATTRIBUTE}] :where(footer button:disabled) {
  opacity: 0.5;
  cursor: default;
}
[${DIALOG_ATTRIBUTE}] :where(button:focus-visible, input:focus-visible) {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}
`;

function element<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  attributes: Record<string, string> = {},
  text?: string,
) {
  const node = doc.createElement(tag);
  for (const [name, value] of Object.entries(attributes))
    node.setAttribute(name, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

export function openPruneDialog(
  doc: Document,
  preview: Preview,
  now: number,
): Promise<string[] | null> {
  return new Promise((resolve) => {
    const previousFocus = doc.activeElement;
    const backdrop = element(doc, "div", {
      [`${DIALOG_ATTRIBUTE}-backdrop`]: "",
    });
    const dialog = element(doc, "div", {
      [DIALOG_ATTRIBUTE]: "",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "prune-threads-dialog-title",
      "aria-describedby": "prune-threads-dialog-description",
    });
    const header = element(doc, "header");
    header.append(
      element(doc, "h2", { id: "prune-threads-dialog-title" }, "Prune threads"),
      element(
        doc,
        "p",
        { id: "prune-threads-dialog-description" },
        "These threads are read, finished, idle for over 24 hours, and have nothing left to push. Uncheck any you want to keep. Deleting cannot be undone.",
      ),
    );

    const toolbar = element(doc, "div", {
      [`${DIALOG_ATTRIBUTE}-toolbar`]: "",
    });
    const selectAllLabel = element(doc, "label");
    const selectAll = element(doc, "input", { type: "checkbox" });
    selectAllLabel.append(selectAll, element(doc, "span", {}, "Select all"));
    const count = element(doc, "span", { [`${DIALOG_ATTRIBUTE}-count`]: "" });
    toolbar.append(selectAllLabel, count);

    const list = element(doc, "ul", { [`${DIALOG_ATTRIBUTE}-list`]: "" });
    const boxes: HTMLInputElement[] = [];
    for (const group of preview.groups) {
      const item = element(doc, "li");
      const label = element(doc, "label");
      const box = element(doc, "input", {
        type: "checkbox",
        [ROOT_ID_ATTRIBUTE]: group.rootId,
      });
      box.checked = true;
      boxes.push(box);
      const text = element(doc, "span", { [`${DIALOG_ATTRIBUTE}-text`]: "" });
      const title = element(
        doc,
        "span",
        { [`${DIALOG_ATTRIBUTE}-title`]: "", title: group.title },
        group.title,
      );
      const details = groupDetails(group, now).join(" · ");
      text.append(
        title,
        element(
          doc,
          "span",
          { [`${DIALOG_ATTRIBUTE}-meta`]: "", title: details },
          details,
        ),
      );
      label.append(box, text);
      item.append(label);
      list.append(item);
    }

    const footer = element(doc, "footer");
    const cancel = element(doc, "button", { type: "button" }, "Cancel");
    const confirm = element(doc, "button", {
      type: "button",
      "data-destructive": "",
    });
    footer.append(cancel, confirm);
    dialog.append(header, toolbar, list, footer);
    backdrop.append(dialog);

    const selectedIds = () =>
      boxes
        .filter((box) => box.checked)
        .map((box) => box.getAttribute(ROOT_ID_ATTRIBUTE)!);
    const selectedThreadCount = () => {
      const chosen = new Set(selectedIds());
      return preview.groups
        .filter((group) => chosen.has(group.rootId))
        .reduce((total, group) => total + group.threadIds.length, 0);
    };
    const refresh = () => {
      const selected = selectedIds().length;
      selectAll.checked = selected === boxes.length;
      selectAll.indeterminate = selected > 0 && selected < boxes.length;
      count.textContent = `${selected} of ${boxes.length} selected`;
      const threads = selectedThreadCount();
      confirm.textContent =
        threads === 0
          ? "Delete"
          : `Delete ${threads} thread${threads === 1 ? "" : "s"}`;
      confirm.disabled = threads === 0;
    };

    const close = (result: string[] | null) => {
      doc.removeEventListener("keydown", onKeyDown, true);
      backdrop.remove();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus();
      resolve(result);
    };
    const focusable = () =>
      [...dialog.querySelectorAll<HTMLElement>("input, button")].filter(
        (node) => !(node as HTMLButtonElement).disabled,
      );
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close(null);
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = focusable();
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (first === undefined || last === undefined) return;
      const active = doc.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (active === last || !dialog.contains(active))
      ) {
        event.preventDefault();
        first.focus();
      }
    };

    selectAll.addEventListener("change", () => {
      for (const box of boxes) box.checked = selectAll.checked;
      refresh();
    });
    list.addEventListener("change", refresh);
    cancel.addEventListener("click", () => close(null));
    confirm.addEventListener("click", () => close(selectedIds()));
    backdrop.addEventListener("mousedown", (event) => {
      if (event.target === backdrop) close(null);
    });
    doc.addEventListener("keydown", onKeyDown, true);

    refresh();
    doc.body.append(backdrop);
    cancel.focus();
  });
}
