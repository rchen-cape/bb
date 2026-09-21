// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  shouldShowAwaitingReplyCard,
  ThreadAwaitingReplyCard,
} from "./ThreadAwaitingReplyCard";

afterEach(cleanup);

function renderCard(
  overrides: Partial<Parameters<typeof ThreadAwaitingReplyCard>[0]> = {},
): {
  onDeclineFollowUp: ReturnType<typeof vi.fn>;
  onDraftChange: ReturnType<typeof vi.fn>;
  onSend: ReturnType<typeof vi.fn>;
  onUseComposer: ReturnType<typeof vi.fn>;
} {
  const handlers = {
    onDeclineFollowUp: vi.fn(),
    onDraftChange: vi.fn(),
    onSend: vi.fn(),
    onUseComposer: vi.fn(),
  };
  render(
    <ThreadAwaitingReplyCard
      draftText=""
      isDismissPending={false}
      isSendDisabled={false}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

function replyBox(): HTMLTextAreaElement {
  return screen.getByLabelText(
    "Reply to the agent's question",
  ) as HTMLTextAreaElement;
}

describe("ThreadAwaitingReplyCard", () => {
  it("puts a reply box in the composer's place, alongside declining", () => {
    renderCard();

    expect(replyBox().placeholder).toBe("Reply…");
    expect(
      screen.getByRole("button", { name: /^Decline follow up/ }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Address" })).toBeNull();
  });

  it("reports typing so the reply shares the thread's draft", () => {
    const { onDraftChange } = renderCard();

    fireEvent.change(replyBox(), { target: { value: "check the rest" } });

    expect(onDraftChange).toHaveBeenCalledWith("check the rest");
  });

  it("sends on Enter once the reply has content", () => {
    const { onSend } = renderCard({ draftText: "check the rest" });

    fireEvent.keyDown(replyBox(), { key: "Enter" });

    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["the reply is empty", { draftText: "   " }, { key: "Enter" }],
    [
      "the thread cannot accept a send",
      { isSendDisabled: true },
      { key: "Enter" },
    ],
  ])("does not send when %s", (_label, props, event) => {
    const { onSend } = renderCard(props);

    fireEvent.keyDown(replyBox(), event);

    expect(onSend).not.toHaveBeenCalled();
  });

  it("keeps Shift+Enter for a newline", () => {
    const { onSend } = renderCard({ draftText: "first line" });

    fireEvent.keyDown(replyBox(), { key: "Enter", shiftKey: true });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("disables the send button until the reply has content", () => {
    renderCard();

    expect(
      screen
        .getByRole("button", { name: "Send reply" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("declines, and blocks a second decline while the first is in flight", () => {
    const { onDeclineFollowUp } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: /^Decline follow up/ }));
    expect(onDeclineFollowUp).toHaveBeenCalledTimes(1);

    cleanup();
    const pending = renderCard({ isDismissPending: true });
    fireEvent.click(screen.getByRole("button", { name: /^Decline follow up/ }));
    expect(pending.onDeclineFollowUp).not.toHaveBeenCalled();
  });

  it("hands back to the full composer on request", () => {
    const { onUseComposer } = renderCard();

    fireEvent.click(screen.getByRole("button", { name: "Reply in composer" }));

    expect(onUseComposer).toHaveBeenCalledTimes(1);
  });
});

describe("shouldShowAwaitingReplyCard", () => {
  const waiting = {
    awaitingUserReply: true,
    hasAddressed: false,
    hasPendingInteraction: false,
    isComposerHidden: false,
    isThreadIdle: true,
  };

  it("takes the composer's place on a thread waiting on a prose question", () => {
    expect(shouldShowAwaitingReplyCard(waiting)).toBe(true);
  });

  it.each([
    ["the agent asked nothing", { awaitingUserReply: false }],
    ["a structured interaction owns the turn", { hasPendingInteraction: true }],
    ["there is no composer to take the place of", { isComposerHidden: true }],
    ["the user asked for the full composer", { hasAddressed: true }],
    ["the thread is running again", { isThreadIdle: false }],
  ])("stays hidden when %s", (_label, overrides) => {
    expect(shouldShowAwaitingReplyCard({ ...waiting, ...overrides })).toBe(
      false,
    );
  });
});
