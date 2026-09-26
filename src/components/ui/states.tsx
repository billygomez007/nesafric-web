import type { ReactNode } from "react";

/**
 * Shared loading / empty / error / success states. Plain, specific, and always pointing at the
 * next step — never decorative. Adopt these where a screen is already being touched; do not
 * rewrite complex workflows just to swap them in.
 */

/** Placeholder block. Pass sizing classes (e.g. "h-4 w-40"). Motion is off for reduced-motion. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`block rounded-[var(--radius-media)] bg-cream/80 motion-safe:animate-pulse ${className}`} />;
}

/** Accessible loading wrapper: screen readers hear `label`, sighted users see the skeleton. */
export function LoadingState({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div aria-busy="true" aria-live="polite" role="status">
      <span className="sr-only">{label}</span>
      {children ?? (
        <div className="grid gap-3 py-2">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  className = "",
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`border-y border-hairline px-1 py-10 sm:py-12 ${className}`}>
      <p className="font-display text-lg font-semibold text-forest-deep">{title}</p>
      {description && <p className="mt-2 max-w-xl text-sm leading-6 text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  className = "",
}: {
  title?: string;
  message?: ReactNode;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={`border-l-2 border-danger bg-danger-tint px-4 py-3.5 ${className}`} role="alert">
      <p className="text-sm font-semibold text-danger-ink">{title}</p>
      {message && <p className="mt-1 text-sm leading-6 text-danger-ink/90">{message}</p>}
      {onRetry && (
        <button
          className="mt-2 text-sm font-semibold text-danger-ink underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger-ink"
          onClick={onRetry}
          type="button"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function SuccessNotice({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`border-l-2 border-success bg-success-tint px-4 py-3 text-sm font-medium text-success ${className}`} role="status">
      {children}
    </p>
  );
}
