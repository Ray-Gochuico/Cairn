import { FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { exitExploreMode } from '@/lib/explore-transitions';

/**
 * W4 (D-S5): the one persistent explore label — app-level chrome above
 * Sidebar + content, rendered by PageShell only while isExploreMode().
 * Info-toned (calm, not alarming), never dismissible. Sits in normal flow:
 * dimmed under open Radix dialogs like all chrome (decision ⚑5 — a modal
 * moment is transient and the page behind it stays labeled).
 * One app-global label by design — no per-card "sample" badges (the house
 * "never a demo number" rule is not violated: in explore EVERYTHING is
 * sample, and this banner is the single persistent voice saying so).
 */
export function SampleDataBanner() {
  return (
    <div
      role="note"
      aria-label="Sample data notice"
      className="flex items-center justify-between gap-4 border-b border-info/40 bg-info-soft px-4 py-2 text-sm text-info-foreground"
    >
      <p className="flex min-w-0 items-center gap-2">
        <FlaskConical className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0">
          <span className="font-medium">Sample data — nothing here is yours.</span>{' '}
          It disappears when you leave — changes here aren&apos;t saved.
        </span>
      </p>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={() => void exitExploreMode()}
      >
        Start my real setup
      </Button>
    </div>
  );
}
