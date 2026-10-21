import {
  HIGHLIGHT_KINDS,
  classifyInlineCode,
  createTextMatcher,
  type HighlightKind,
  type TextMatcher,
} from "./rules.js";
import { highlightName } from "./styles.js";

export const MESSAGE_COLUMN_SELECTOR = "[data-message-column]";
const BLOCK_SELECTOR =
  "p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, dt, dd";
const SKIPPED_SELECTOR = "pre, code, a, kbd, button, svg, textarea, input";
const FLUSH_INTERVAL_MS = 150;
const VIEWPORT_MARGIN = "600px 0px";

export interface HighlighterOptions {
  enabled: boolean;
  customKeywords: readonly string[];
}

export interface Highlighter {
  update(options: HighlighterOptions): void;
  dispose(): void;
}

interface TrackedRange {
  kind: HighlightKind;
  range: Range;
}

interface BlockState {
  text: string;
  ranges: TrackedRange[];
}

export function highlightsSupported(win: typeof globalThis): boolean {
  return (
    typeof win.Highlight === "function" &&
    typeof win.CSS !== "undefined" &&
    "highlights" in win.CSS &&
    typeof win.IntersectionObserver === "function" &&
    typeof win.MutationObserver === "function"
  );
}

function isAssistantColumn(column: Element): boolean {
  return column.querySelector(":scope > .ml-auto") === null;
}

export function startHighlighter(
  doc: Document,
  initial: HighlighterOptions,
): Highlighter {
  const win = globalThis;
  if (!highlightsSupported(win)) {
    return { update() {}, dispose() {} };
  }
  const registry = win.CSS.highlights;
  const highlights = new Map<HighlightKind, Highlight>();
  for (const kind of HIGHLIGHT_KINDS) {
    const highlight = new win.Highlight();
    highlights.set(kind, highlight);
    registry.set(highlightName(kind), highlight);
  }

  let enabled = initial.enabled;
  let matcher: TextMatcher = createTextMatcher(initial.customKeywords);
  let blockStates = new WeakMap<Element, BlockState>();
  const columnBlocks = new Map<Element, Set<Element>>();
  const observedColumns = new Set<Element>();
  const visibleColumns = new Set<Element>();
  const dirtyColumns = new Set<Element>();
  const dirtyBlocks = new Set<Element>();
  let discoveryDirty = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const schedule = () => {
    if (disposed || timer !== null || !enabled) return;
    timer = setTimeout(flush, FLUSH_INTERVAL_MS);
  };

  const removeRanges = (state: BlockState | undefined) => {
    if (state === undefined) return;
    for (const { kind, range } of state.ranges)
      highlights.get(kind)?.delete(range);
  };

  const dropBlock = (block: Element) => {
    removeRanges(blockStates.get(block));
    blockStates.delete(block);
  };

  const dropColumn = (column: Element) => {
    for (const block of columnBlocks.get(column) ?? []) dropBlock(block);
    columnBlocks.delete(column);
    dirtyColumns.delete(column);
  };

  const rangesStillAttached = (state: BlockState, block: Element) =>
    state.ranges.every(
      ({ range }) =>
        range.startContainer.isConnected &&
        block.contains(range.startContainer),
    );

  const scanBlock = (block: Element, column: Element) => {
    const text = block.textContent ?? "";
    const previous = blockStates.get(block);
    if (
      previous !== undefined &&
      previous.text === text &&
      rangesStillAttached(previous, block)
    ) {
      return;
    }
    removeRanges(previous);
    const ranges: TrackedRange[] = [];
    const add = (kind: HighlightKind, range: Range) => {
      highlights.get(kind)?.add(range);
      ranges.push({ kind, range });
    };

    const walker = doc.createTreeWalker(
      block,
      win.NodeFilter.SHOW_ELEMENT | win.NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (node.nodeType === win.Node.TEXT_NODE)
            return win.NodeFilter.FILTER_ACCEPT;
          const element = node as Element;
          if (element !== block && element.matches(BLOCK_SELECTOR)) {
            return win.NodeFilter.FILTER_REJECT;
          }
          if (element.matches("code") && element.closest("pre") === null) {
            const kind = classifyInlineCode(element.textContent ?? "");
            if (kind !== null) {
              const range = doc.createRange();
              range.selectNodeContents(element);
              add(kind, range);
            }
            return win.NodeFilter.FILTER_REJECT;
          }
          return element.matches(SKIPPED_SELECTOR)
            ? win.NodeFilter.FILTER_REJECT
            : win.NodeFilter.FILTER_SKIP;
        },
      },
    );
    for (
      let node = walker.nextNode();
      node !== null;
      node = walker.nextNode()
    ) {
      const textNode = node as Text;
      for (const match of matcher.find(textNode.data)) {
        const range = doc.createRange();
        range.setStart(textNode, match.start);
        range.setEnd(textNode, match.end);
        add(match.kind, range);
      }
    }
    blockStates.set(block, { text, ranges });
    let blocks = columnBlocks.get(column);
    if (blocks === undefined) {
      blocks = new Set();
      columnBlocks.set(column, blocks);
    }
    blocks.add(block);
  };

  const scanColumn = (column: Element) => {
    const seen = new Set<Element>();
    for (const block of column.querySelectorAll(BLOCK_SELECTOR)) {
      if (block.closest("pre") !== null) continue;
      seen.add(block);
      scanBlock(block, column);
    }
    const tracked = columnBlocks.get(column);
    if (tracked === undefined) return;
    for (const block of tracked) {
      if (!seen.has(block)) {
        dropBlock(block);
        tracked.delete(block);
      }
    }
  };

  const contentObserver = new win.MutationObserver((records) => {
    markDirty(records);
    schedule();
  });

  const markDirty = (records: readonly MutationRecord[]) => {
    for (const record of records) {
      const element =
        record.target.nodeType === win.Node.ELEMENT_NODE
          ? (record.target as Element)
          : record.target.parentElement;
      if (element === null) continue;
      const column = element.closest(MESSAGE_COLUMN_SELECTOR);
      if (column === null || !visibleColumns.has(column)) continue;
      const block = element.closest(BLOCK_SELECTOR);
      const addsBlock =
        record.type === "childList" &&
        Array.from(record.addedNodes).some(
          (node) =>
            node.nodeType === win.Node.ELEMENT_NODE &&
            ((node as Element).matches(BLOCK_SELECTOR) ||
              (node as Element).querySelector(BLOCK_SELECTOR) !== null),
        );
      if (block !== null && !addsBlock && column.contains(block)) {
        dirtyBlocks.add(block);
      } else {
        dirtyColumns.add(column);
      }
    }
  };

  const resubscribeContent = () => {
    markDirty(contentObserver.takeRecords());
    contentObserver.disconnect();
    if (!enabled) return;
    for (const column of visibleColumns) {
      contentObserver.observe(column, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }
  };

  const visibilityObserver = new win.IntersectionObserver(
    (entries) => {
      let changed = false;
      for (const entry of entries) {
        if (entry.isIntersecting) {
          if (!visibleColumns.has(entry.target)) {
            visibleColumns.add(entry.target);
            dirtyColumns.add(entry.target);
            changed = true;
          }
        } else if (visibleColumns.delete(entry.target)) {
          changed = true;
        }
      }
      if (changed) {
        resubscribeContent();
        schedule();
      }
    },
    { rootMargin: VIEWPORT_MARGIN },
  );

  const discover = () => {
    discoveryDirty = false;
    let visibilityChanged = false;
    for (const column of observedColumns) {
      if (column.isConnected) continue;
      visibilityObserver.unobserve(column);
      observedColumns.delete(column);
      if (visibleColumns.delete(column)) visibilityChanged = true;
      dropColumn(column);
    }
    for (const column of doc.querySelectorAll(MESSAGE_COLUMN_SELECTOR)) {
      if (observedColumns.has(column) || !isAssistantColumn(column)) continue;
      observedColumns.add(column);
      visibilityObserver.observe(column);
    }
    if (visibilityChanged) resubscribeContent();
  };

  function flush() {
    timer = null;
    if (disposed || !enabled) return;
    if (doc.hidden) return;
    markDirty(contentObserver.takeRecords());
    if (discoveryDirty) discover();
    for (const column of dirtyColumns) {
      if (visibleColumns.has(column) && column.isConnected) scanColumn(column);
    }
    for (const block of dirtyBlocks) {
      const column = block.closest(MESSAGE_COLUMN_SELECTOR);
      if (
        column !== null &&
        visibleColumns.has(column) &&
        !dirtyColumns.has(column)
      ) {
        scanBlock(block, column);
      }
    }
    dirtyColumns.clear();
    dirtyBlocks.clear();
  }

  const discoveryObserver = new win.MutationObserver(() => {
    if (discoveryDirty) return;
    discoveryDirty = true;
    schedule();
  });

  const onVisibilityChange = () => {
    if (!doc.hidden) schedule();
  };

  const clearAll = () => {
    for (const highlight of highlights.values()) highlight.clear();
    blockStates = new WeakMap();
    columnBlocks.clear();
  };

  const start = () => {
    discoveryObserver.observe(doc.body, { childList: true, subtree: true });
    doc.addEventListener("visibilitychange", onVisibilityChange);
    discoveryDirty = true;
    for (const column of visibleColumns) dirtyColumns.add(column);
    resubscribeContent();
    schedule();
  };

  const stop = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    discoveryObserver.disconnect();
    contentObserver.disconnect();
    doc.removeEventListener("visibilitychange", onVisibilityChange);
    clearAll();
  };

  if (enabled) start();

  return {
    update(options) {
      if (disposed) return;
      const wasEnabled = enabled;
      enabled = options.enabled;
      matcher = createTextMatcher(options.customKeywords);
      if (wasEnabled) stop();
      if (enabled) start();
    },
    dispose() {
      if (disposed) return;
      stop();
      disposed = true;
      visibilityObserver.disconnect();
      for (const kind of HIGHLIGHT_KINDS) {
        const name = highlightName(kind);
        if (registry.get(name) === highlights.get(kind)) registry.delete(name);
      }
    },
  };
}
