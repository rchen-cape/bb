// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startClickToCopy, type ClickToCopy } from "./lib/click-to-copy.js";
import { COPY_TIP_ATTRIBUTE } from "./lib/copy-tip.js";
import { COPIED_HIGHLIGHT_NAME } from "./lib/styles.js";

class FakeHighlight extends Set<Range> {}

const registry = new Map<string, FakeHighlight>();
let controller: ClickToCopy | null = null;
const copy = vi.fn(async (_text: string) => true);

function mount(html: string) {
  const column = document.createElement("div");
  column.setAttribute("data-message-column", "");
  column.innerHTML = html;
  document.body.append(column);
  return column;
}

function click(element: Element, init: MouseEventInit = {}) {
  element.dispatchEvent(
    new MouseEvent("click", { bubbles: true, button: 0, ...init }),
  );
}

function pointer(
  type: "pointerover" | "pointerout",
  element: Element,
  relatedTarget: Element | null = null,
  pointerType = "mouse",
) {
  const event = new MouseEvent(type, { bubbles: true, relatedTarget });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  element.dispatchEvent(event);
}

const visibleTip = () =>
  document.querySelector<HTMLElement>(`[${COPY_TIP_ATTRIBUTE}][data-visible]`);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("Highlight", FakeHighlight);
  vi.stubGlobal("CSS", { highlights: registry });
  copy.mockClear();
});

afterEach(() => {
  controller?.dispose();
  controller = null;
  registry.clear();
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("startClickToCopy", () => {
  it("copies inline code and flashes it until the timer ends", async () => {
    const column = mount("<p>Run <code>pnpm <b>test</b></code> now</p>");
    controller = startClickToCopy(document, copy, true);

    click(column.querySelector("b")!);
    await vi.waitFor(() => expect(copy).toHaveBeenCalledWith("pnpm test"));
    await Promise.resolve();
    const flash = registry.get(COPIED_HIGHLIGHT_NAME)!;
    expect([...flash].map((range) => range.toString())).toEqual(["pnpm test"]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(flash.size).toBe(0);
  });

  it.each([
    ["a code block", "<pre><code>ls</code></pre>"],
    ["a link", '<p><a href="#"><code>ls</code></a></p>'],
  ])("ignores code inside %s", (_label, html) => {
    const column = mount(html);
    controller = startClickToCopy(document, copy, true);

    click(column.querySelector("code")!);

    expect(copy).not.toHaveBeenCalled();
  });

  it("ignores code outside chat messages", () => {
    document.body.innerHTML = "<p><code>ls</code></p>";
    controller = startClickToCopy(document, copy, true);

    click(document.querySelector("code")!);

    expect(copy).not.toHaveBeenCalled();
  });

  it("leaves drag selections and modifier clicks alone", () => {
    const column = mount("<p><code>ls -la</code></p>");
    controller = startClickToCopy(document, copy, true);
    const code = column.querySelector("code")!;

    click(code, { metaKey: true });
    const range = document.createRange();
    range.selectNodeContents(code);
    window.getSelection()!.addRange(range);
    click(code);

    expect(copy).not.toHaveBeenCalled();
  });

  it("shows a hint after hovering, and hides it on leave", async () => {
    const column = mount("<p>Run <code>pnpm <b>test</b></code> now</p>");
    controller = startClickToCopy(document, copy, true);
    const code = column.querySelector("code")!;

    pointer("pointerover", column.querySelector("b")!);
    expect(visibleTip()).toBeNull();
    await vi.advanceTimersByTimeAsync(400);
    expect(visibleTip()?.textContent).toBe("Click to copy");

    pointer("pointerout", column.querySelector("b")!, code);
    expect(visibleTip()?.textContent).toBe("Click to copy");
    pointer("pointerout", code, column);
    expect(visibleTip()).toBeNull();
  });

  it("skips the hint when the pointer only passes over", async () => {
    const column = mount("<p><code>ls</code></p>");
    controller = startClickToCopy(document, copy, true);
    const code = column.querySelector("code")!;

    pointer("pointerover", code);
    pointer("pointerout", code, column);
    await vi.advanceTimersByTimeAsync(1000);

    expect(visibleTip()).toBeNull();
  });

  it("ignores touch hovers and code that cannot be copied", async () => {
    const column = mount(
      '<p><code>ls</code><a href="#"><code>x</code></a></p>',
    );
    controller = startClickToCopy(document, copy, true);

    pointer("pointerover", column.querySelector("code")!, null, "touch");
    pointer("pointerover", column.querySelector("a code")!);
    await vi.advanceTimersByTimeAsync(1000);

    expect(visibleTip()).toBeNull();
  });

  it("says Copied after a click, then hides", async () => {
    const column = mount("<p><code>ls</code></p>");
    controller = startClickToCopy(document, copy, true);

    click(column.querySelector("code")!);
    await vi.waitFor(() => expect(visibleTip()?.dataset.state).toBe("copied"));
    expect(visibleTip()?.textContent).toBe("Copied");

    await vi.advanceTimersByTimeAsync(1000);
    expect(visibleTip()).toBeNull();
  });

  it("hides the hint on scroll and removes it on dispose", async () => {
    const column = mount("<p><code>ls</code></p>");
    controller = startClickToCopy(document, copy, true);
    pointer("pointerover", column.querySelector("code")!);
    await vi.advanceTimersByTimeAsync(400);

    document.dispatchEvent(new Event("scroll"));
    expect(visibleTip()).toBeNull();
    controller.dispose();
    expect(document.querySelector(`[${COPY_TIP_ATTRIBUTE}]`)).toBeNull();
  });

  it("stops copying when turned off and after dispose", () => {
    const column = mount("<p><code>ls</code></p>");
    controller = startClickToCopy(document, copy, true);
    const code = column.querySelector("code")!;

    controller.setEnabled(false);
    click(code);
    controller.setEnabled(true);
    controller.dispose();
    click(code);

    expect(copy).not.toHaveBeenCalled();
    expect(registry.has(COPIED_HIGHLIGHT_NAME)).toBe(false);
  });
});
