import { useState, type ReactNode } from 'react';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronDownIcon, ChevronUpIcon, SettingsIcon } from 'lucide-react';
import { useAutoRowSpan } from '@/lib/use-auto-row-span';

interface CalculatorCardProps {
  /**
   * The card title. Accepts a ReactNode so callers can wrap parts of the
   * label in `<TermTooltip>` for in-place glossary definitions without
   * losing the literal text (e.g., "Years to FI" with FI defined inline).
   */
  title: string | ReactNode;
  /**
   * Plain-text version of `title` used for accessibility (`aria-label` on
   * the Hide button, etc.). Defaults to `title` when it's a string. Provide
   * this whenever `title` is a ReactNode (e.g., wraps a `<TermTooltip>`).
   */
  titleText?: string;
  headline: string | ReactNode;
  defaultExpanded?: boolean;
  overridePanel?: ReactNode;
  /** Stable identifier used for the Hide/Show feature. When set, a "Hide" button is rendered. */
  cardId?: string;
  /**
   * Invoked when the user clicks "Hide". The parent owns the visibility state
   * and persists it — the card does not write to localStorage itself, so the
   * state update + persistence happen atomically from one source.
   */
  onHide?: (cardId: string) => void;
  children: ReactNode;
}

export function CalculatorCard({
  title,
  titleText,
  headline,
  defaultExpanded = true,
  overridePanel,
  cardId,
  onHide,
  children,
}: CalculatorCardProps) {
  const resolvedTitleText =
    titleText ?? (typeof title === 'string' ? title : undefined);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showOverride, setShowOverride] = useState(false);
  const { ref, span } = useAutoRowSpan();

  const handleHide = () => {
    if (!cardId) return;
    onHide?.(cardId);
  };

  return (
    <Card ref={ref} className="min-w-0" style={{ gridRow: `span ${span}` }}>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-muted-foreground">{title}</div>
          <div className="text-xl sm:text-2xl font-semibold tabular-nums break-words min-w-0">{headline}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {overridePanel && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowOverride((v) => !v)}
              aria-label={showOverride ? 'Hide override panel' : 'Override inputs'}
            >
              <SettingsIcon className="h-4 w-4 mr-1" /> Override
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
          </Button>
          {cardId && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleHide}
              aria-label={resolvedTitleText ? `Hide ${resolvedTitleText} card` : 'Hide card'}
              className="text-muted-foreground"
            >
              Hide
            </Button>
          )}
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-4 min-w-0">
          {showOverride && overridePanel && (
            <div className="rounded-md border bg-muted/40 p-3 space-y-2">
              <div className="text-sm font-medium">Override inputs</div>
              {overridePanel}
              <div className="text-xs text-muted-foreground">Changes are temporary. Save-as-What-If is coming in Phase 5.</div>
            </div>
          )}
          {children}
        </CardContent>
      )}
    </Card>
  );
}
