// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startHighlighter, type Highlighter } from "./lib/highlighter.js";
import { highlightName } from "./lib/styles.js";

class FakeHighlight extends Set<Range> {}

const observers: FakeIntersectionObserver[] = [];

class FakeIntersectionObserver {
  readonly targets = new Set<Element>();
  constructor(readonly callback: IntersectionObserverCallback) {
    observers.push(this);
  }
  observe(target: Element) {
    this.targets.add(target);
    this.callback(
      [{ target, isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
  }
}

const registry = new Map<string, FakeHighlight>();
let highlighter: Highlighter | null = null;

function texts(kind: Parameters<typeof highlightName>[0]) {
  return [...(registry.get(highlightName(kind)) ?? [])].map((range) =>
    range.toString(),
  );
}

async function settle() {
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(200);
}

function mountAssistant(html: string): HTMLElement {
  const column = document.createElement("div");
  column.setAttribute("data-message-column", "");
  column.innerHTML = html;
  document.body.append(column);
  return column;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("Highlight", FakeHighlight);
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  vi.stubGlobal("CSS", { highlights: registry });
});

afterEach(() => {
  highlighter?.dispose();
  highlighter = null;
  registry.clear();
  observers.length = 0;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("startHighlighter", () => {
  it("highlights assistant prose, skips code blocks and links, and classifies inline code", async () => {
    mountAssistant(
      '<p><strong>Todo:</strong> fix it, the run <a href="#">failed</a> and <code>pnpm test</code> errors</p><pre><code>Todo: no</code></pre>',
    );
    highlighter = startHighlighter(document, {
      enabled: true,
      customKeywords: [],
    });
    await settle();

    expect(texts("todo")).toEqual(["Todo:"]);
    expect(texts("error")).toEqual(["errors"]);
    expect(texts("code-command")).toEqual(["pnpm test"]);
  });

  it("ignores user messages", async () => {
    mountAssistant('<div class="ml-auto"><p>Todo: mine</p></div>');
    highlighter = startHighlighter(document, {
      enabled: true,
      customKeywords: [],
    });
    await settle();

    expect(texts("todo")).toEqual([]);
  });

  it("rescans only the block whose text changed while streaming", async () => {
    const column = mountAssistant("<p>first failed</p><p>second</p>");
    highlighter = startHighlighter(document, {
      enabled: true,
      customKeywords: [],
    });
    await settle();
    const firstRange = [...registry.get(highlightName("error"))!][0];
    const createRange = vi.spyOn(document, "createRange");

    column.querySelectorAll("p")[1]!.firstChild!.textContent = "second crashed";
    await settle();

    expect(texts("error")).toEqual(["failed", "crashed"]);
    expect([...registry.get(highlightName("error"))!][0]).toBe(firstRange);
    expect(createRange).toHaveBeenCalledTimes(1);
  });

  it("drops ranges when a message leaves the page", async () => {
    const column = mountAssistant("<p>Todo: gone soon</p>");
    highlighter = startHighlighter(document, {
      enabled: true,
      customKeywords: [],
    });
    await settle();
    expect(texts("todo")).toHaveLength(1);

    column.remove();
    await settle();

    expect(texts("todo")).toEqual([]);
  });

  it("clears highlights when turned off and restores them when turned on", async () => {
    mountAssistant("<p>Todo: toggle rollback</p>");
    highlighter = startHighlighter(document, {
      enabled: true,
      customKeywords: [],
    });
    await settle();

    highlighter.update({ enabled: false, customKeywords: [] });
    await settle();
    expect(texts("todo")).toEqual([]);

    highlighter.update({ enabled: true, customKeywords: ["rollback"] });
    await settle();
    expect(texts("todo")).toEqual(["Todo:"]);
    expect(texts("keyword")).toEqual(["rollback"]);
  });

  it("unregisters its highlights on dispose", async () => {
    highlighter = startHighlighter(document, {
      enabled: true,
      customKeywords: [],
    });
    expect(registry.size).toBeGreaterThan(0);
    highlighter.dispose();
    expect(registry.size).toBe(0);
  });
});
