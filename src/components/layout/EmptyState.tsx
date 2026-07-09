import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { CairnGlyph } from '@/components/layout/CairnGlyph';
import { cn } from '@/lib/utils';

/**
 * One canonical empty state (Design M-1).
 *
 * Pages previously hand-rolled their "you haven't entered anything yet" cards
 * with drifting copy ("set one up in Inputs" / "add one in Inputs" / "add one
 * from Inputs") and slightly different spacing. EmptyState normalizes the
 * shape: a centered muted decorative mark, a one-line title, an optional
 * description, and an optional CTA passed as children (typically a
 * `<Button asChild><Link…/></Button>`).
 *
 * Wave-12 Trailhead Stone: the decorative mark is now the shared line-drawn
 * cairn glyph (CairnGlyph) — the app-wide empty-state signature. The old
 * per-call-site lucide `icon` prop is deprecated and no longer rendered
 * (it was aria-hidden decoration; the title carries the semantics).
 *
 * Rendered inside a Card by default so it matches the existing empty surfaces;
 * pass `bare` to drop the Card chrome when the caller already provides one
 * (e.g. a Dashboard widget that is itself a Card).
 */
export interface EmptyStateProps {
  /** @deprecated Wave-12: the cairn glyph is the canonical empty-state mark;
   *  prop accepted (no call-site churn) but no longer rendered. Follow-up
   *  chip strips it from call sites. */
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Optional CTA — typically a <Button asChild><Link/></Button>. */
  children?: React.ReactNode;
  /** Drop the surrounding Card chrome (caller supplies its own container). */
  bare?: boolean;
  className?: string;
}

export function EmptyState({
  title,
  description,
  children,
  bare = false,
  className,
}: EmptyStateProps) {
  const body = (
    <div className={cn('flex flex-col items-center text-center', bare ? 'py-6' : 'py-12')}>
      <CairnGlyph className="h-10 w-10 text-muted-foreground" />
      <div className="mt-3 text-sm font-medium text-foreground">{title}</div>
      {description && (
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">{description}</p>
      )}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );

  if (bare) {
    return <div className={className}>{body}</div>;
  }

  return (
    <Card className={className}>
      <CardContent className="p-0">{body}</CardContent>
    </Card>
  );
}

export default EmptyState;
