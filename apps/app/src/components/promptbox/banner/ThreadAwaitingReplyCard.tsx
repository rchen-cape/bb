import { Icon } from "@bb/shared-ui/icon";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import { PromptBannerActionButton } from "@/components/promptbox/banner/prompt-banner-actions";

export interface AwaitingReplyCardVisibility {
  awaitingUserReply: boolean;
  hasAddressed: boolean;
  hasPendingInteraction: boolean;
  isComposerHidden: boolean;
}

/**
 * Whether to offer the decline/address choice above the composer.
 *
 * A structured interaction already renders its own choices, and answering one
 * is how the user replies, so the card would be a second prompt for the same
 * turn. With no composer to focus, addressing is impossible.
 */
export function shouldShowAwaitingReplyCard(
  state: AwaitingReplyCardVisibility,
): boolean {
  return (
    state.awaitingUserReply &&
    !state.hasPendingInteraction &&
    !state.isComposerHidden &&
    !state.hasAddressed
  );
}

interface ThreadAwaitingReplyCardProps {
  isDismissPending: boolean;
  onAddress: () => void;
  onDecline: () => void;
}

export function ThreadAwaitingReplyCard({
  isDismissPending,
  onAddress,
  onDecline,
}: ThreadAwaitingReplyCardProps) {
  return (
    <PromptStackCard ariaLabel="Follow-up" className="overflow-hidden">
      <div
        role="group"
        aria-label="Follow-up on the agent's question"
        className="flex min-h-8 items-center gap-1.5 px-3 py-1.5 text-xs"
      >
        <Icon
          name="CircleQuestion"
          className="size-3.5 shrink-0 text-attention"
          aria-hidden="true"
        />
        <span className="shrink-0 font-medium text-foreground">
          Waiting on you
        </span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          The agent ended its last turn with a question.
        </span>
        <PromptBannerActionButton
          onClick={onDecline}
          disabled={isDismissPending}
        >
          Decline follow up
        </PromptBannerActionButton>
        <PromptBannerActionButton onClick={onAddress}>
          Address
        </PromptBannerActionButton>
      </div>
    </PromptStackCard>
  );
}
