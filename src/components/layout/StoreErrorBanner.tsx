import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Surfaces store load failures at the top of a page (Frontend H1).
 *
 * Before this banner, no page read `store.error`: a failed `load()` fell
 * through to the page's calm empty state ("No transactions yet…"), which
 * wrongly implies the user's data vanished. This banner makes a load failure
 * legible and recoverable — and pages suppress their empty-state copy when an
 * error is set, so "empty because new" and "empty because the load failed"
 * stay distinct.
 *
 * The component is intentionally dumb: it takes the `error` values a page has
 * already subscribed to (each store exposes `error: string | null`) plus a
 * single `onRetry` that re-calls the page's `load()`s. It renders nothing when
 * every error is null/undefined, so a page can mount it unconditionally above
 * its content.
 *
 * Tone is amber/warning, not destructive-red: a transient read failure is
 * recoverable (retry), not a dangerous action — and the copy reassures the
 * user their data is intact.
 */
export interface StoreErrorBannerProps {
  /** The `error` field from each consumed store. Nulls/undefineds are ignored. */
  errors: Array<string | null | undefined>;
  /** Re-run the page's loads. Omit to render an info-only banner. */
  onRetry?: () => void;
  className?: string;
}

export function StoreErrorBanner({ errors, onRetry, className }: StoreErrorBannerProps) {
  const firstError = errors.find((e): e is string => typeof e === 'string' && e.length > 0);
  if (!firstError) return null;

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 rounded-md border border-warning/40 bg-warning-soft p-4',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <AlertTriangle
          className="mt-0.5 h-5 w-5 shrink-0 text-warning-foreground"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <div className="font-medium text-warning-foreground">
            We couldn’t load some of this page
          </div>
          <p className="text-sm text-warning-foreground/80">
            Your data is safe — this is a load error, not missing data.{' '}
            <span className="break-words">{firstError}</span>
          </p>
        </div>
      </div>
      {onRetry && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onRetry}
          className="shrink-0 border-warning/50 text-warning-foreground hover:bg-warning/10"
        >
          Retry
        </Button>
      )}
    </div>
  );
}

export default StoreErrorBanner;
