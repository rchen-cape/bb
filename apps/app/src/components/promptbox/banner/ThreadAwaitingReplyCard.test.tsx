// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  shouldShowAwaitingReplyCard,
  ThreadAwaitingReplyCard,
} from "./ThreadAwaitingReplyCard";

afterEach(cleanup);

describe("ThreadAwaitingReplyCard", () => {
  it("offers declining and addressing as the two ways out", () => {
    const onAddress = vi.fn();
    const onDecline = vi.fn();
    render(
      <ThreadAwaitingReplyCard
        isDismissPending={false}
        onAddress={onAddress}
        onDecline={onDecline}
      />,
    );

    expect(screen.getByText("Waiting on you")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Decline follow up" }));
    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(onAddress).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Address" }));
    expect(onAddress).toHaveBeenCalledTimes(1);
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it("blocks a second decline while the first is in flight", () => {
    const onDecline = vi.fn();
    render(
      <ThreadAwaitingReplyCard
        isDismissPending
        onAddress={vi.fn()}
        onDecline={onDecline}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Decline follow up" }));
    expect(onDecline).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Address" }).hasAttribute("disabled"),
    ).toBe(false);
  });
});

describe("shouldShowAwaitingReplyCard", () => {
  const waiting = {
    awaitingUserReply: true,
    hasAddressed: false,
    hasPendingInteraction: false,
    isComposerHidden: false,
  };

  it("offers the choice on a thread waiting on a prose question", () => {
    expect(shouldShowAwaitingReplyCard(waiting)).toBe(true);
  });

  it.each([
    ["the agent asked nothing", { awaitingUserReply: false }],
    ["a structured interaction owns the turn", { hasPendingInteraction: true }],
    ["there is no composer to focus", { isComposerHidden: true }],
    ["the user already chose to address it", { hasAddressed: true }],
  ])("stays hidden when %s", (_label, overrides) => {
    expect(shouldShowAwaitingReplyCard({ ...waiting, ...overrides })).toBe(
      false,
    );
  });
});
