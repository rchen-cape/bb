import type { ReactNode } from "react";
import { Button } from "@bb/shared-ui/button";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { Icon } from "@bb/shared-ui/icon";

export function LoadingLine({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="py-6 text-center text-xs text-subtle-foreground"
    >
      {children}
    </p>
  );
}

export function ErrorRow({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
    >
      <Icon name="AlertCircle" className="size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{message}</span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-6 px-2 text-xs"
        onClick={onRetry}
      >
        Retry
      </Button>
    </div>
  );
}

export function NotFound({
  title,
  message,
  backLabel,
  onBack,
}: {
  title: string;
  message: string;
  backLabel: string;
  onBack: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl p-4 md:p-5">
      <EmptyStatePanel className="space-y-3">
        <p className="font-medium text-foreground">{title}</p>
        <p className="text-xs">{message}</p>
        <Button type="button" size="sm" variant="outline" onClick={onBack}>
          <Icon name="ArrowLeft" aria-hidden />
          {backLabel}
        </Button>
      </EmptyStatePanel>
    </div>
  );
}
