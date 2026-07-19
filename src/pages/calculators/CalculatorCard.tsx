import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { MoreHorizontalIcon } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CALCULATOR_CARD_DEFS } from '@/lib/calculator-card-layout';
import { CairnGlyph } from '@/components/layout/CairnGlyph';
import { useCalculatorShell } from './calculator-shell-context';

interface CalculatorCardProps {
  /** Card title. ReactNode-friendly for <TermTooltip> labels (D5: the tooltip
   *  button is z-raised above the stretched trigger, never nested in it). */
  title: string | ReactNode;
  /** Plain-text title for aria-labels (Close / card options). Required when
   *  title is a ReactNode. */
  titleText?: string;
  headline: string | ReactNode;
  /**
   * The REST-state meaning line: ONE sentence built ONLY from values the card
   * already renders. Warning states REPLACE it (a degraded headline never
   * keeps a cheerful caption); empty states pass <EmptyMeaning>. Truncates to
   * a single line in both states.
   */
  meaning: ReactNode;
  /** Stable kebab id — trigger/panel wiring, hash target, hide persistence. */
  cardId?: string;
  /** D6: this card's numbers differ from Inputs data (local overrides and/or
   *  shared-scenario edits). Renders the blaze corner tick + "Scenario:" prefix
   *  + sr-only sentence. NEVER color-only. */
  dirty?: boolean;
  /** Input rail (open state, 280px left column at ≥lg): RailReset first when
   *  overridden, assumption fields stacked, RailViewGroup last. */
  rail?: ReactNode;
  /** Results column (open state). */
  children?: ReactNode;
}

/** Empty/no-data waymark sentence: the shared cairn glyph beside the CTA copy.
 *  Keep any Wave-15 <Link> inside children — links stay clickable over the
 *  stretched trigger (D5 z-raise). */
export function EmptyMeaning({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 align-bottom">
      <CairnGlyph className="h-4 w-4 shrink-0" />
      <span className="truncate">{children}</span>
    </span>
  );
}

/** "Reset to my data" — pinned first in the rail. Same idiom the cards used
 *  inline pre-Wave-17 (text-primary underline), one shared shape. */
export function RailReset({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left text-sm text-primary hover:underline"
    >
      Reset to my data
    </button>
  );
}

/** View-only controls (Real/Nominal, withholding method, period selects —
 *  anything that never sets isOverridden) grouped at the rail bottom under a
 *  hairline "View" label. */
export function RailViewGroup({ children }: { children: ReactNode }) {
  return (
    <div className="mt-2 space-y-2 border-t pt-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">View</div>
      {children}
    </div>
  );
}

export function CalculatorCard({
  title,
  titleText,
  headline,
  meaning,
  cardId,
  dirty = false,
  rail,
  children,
}: CalculatorCardProps) {
  const resolvedTitleText =
    titleText ?? (typeof title === 'string' ? title : undefined);
  const shell = useCalculatorShell();
  // No provider (standalone/test render) → open, inert chrome — the old
  // defaultExpanded=true contract (D4).
  const open = shell ? shell.openId === cardId : true;
  const id = cardId ?? 'calculator-card';

  const cardRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const wasOpen = useRef(open);

  const fullPagePath = CALCULATOR_CARD_DEFS.find((d) => d.id === cardId)?.fullPagePath;

  const toggle = () => {
    if (!shell || !cardId) return;
    shell.setOpenId(open ? null : cardId);
  };

  // Esc inside the OPEN panel closes it. D8 guards: defer to anything that
  // already handled the key; defer to the ⋯ menu's own handler; only act when
  // focus is inside THIS card (portaled Radix layers and the section
  // Customize popover live outside the card, so they win by containment).
  useEffect(() => {
    if (!open || !shell || !cardId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (menuOpen) return;
      if (!cardRef.current?.contains(document.activeElement)) return;
      e.preventDefault();
      shell.setOpenId(null);
      triggerRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, shell, cardId, menuOpen]);

  // ⋯ menu Esc — same idiom as the section Customize popover (preventDefault
  // marks it handled so the panel handler above defers).
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  // Scroll the opening card into view — reduced-motion aware; jsdom-safe
  // (neither scrollIntoView nor matchMedia may exist).
  useEffect(() => {
    if (!open || !shell) return;
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    cardRef.current?.scrollIntoView?.({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }, [open, shell]);

  // D9: indirect close (Close button, Customize hide, another card opening)
  // can unmount the focused node — if focus fell to body, restore it to the
  // trigger so keyboard users are never dropped.
  useEffect(() => {
    if (wasOpen.current && !open) {
      const active = document.activeElement;
      if (!active || active === document.body) triggerRef.current?.focus();
    }
    wasOpen.current = open;
    if (!open) setMenuOpen(false);
  }, [open]);

  return (
    <Card
      ref={cardRef}
      id={cardId}
      data-testid={cardId ? `calc-card-${cardId}` : undefined}
      className={cn('relative min-w-0', open ? 'col-span-full' : 'h-32 overflow-hidden')}
    >
      {/* D6: blaze corner tick — a fill-only mark; the "Scenario:" prefix and
          sr-only sentence below carry the meaning (never color-only). */}
      {dirty && (
        <span
          aria-hidden="true"
          data-testid={cardId ? `${id}-scenario-tick` : undefined}
          className="absolute right-0 top-0 h-0 w-0 border-l-[10px] border-t-[10px] border-l-transparent border-t-blaze"
        />
      )}
      <CardHeader
        className={cn(
          'relative block space-y-0.5 p-4',
          !open && 'flex h-full flex-col justify-center',
        )}
      >
        {/* D5: the stretched trigger. Same element in both states — REST it
            covers the whole card (no body renders), OPEN just the header.
            aria-expanded flips in place; focus never moves. */}
        <button
          ref={triggerRef}
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={`panel-${id}`}
          aria-labelledby={`${id}-waymark-title ${id}-headline`}
          data-testid={`${id}-trigger`}
          className="absolute inset-0 z-0 cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
        <div className="pointer-events-none min-w-0 space-y-0.5 [&_a]:pointer-events-auto [&_a]:relative [&_a]:z-10 [&_button]:pointer-events-auto [&_button]:relative [&_button]:z-10">
          <h3
            id={`${id}-waymark-title`}
            className="truncate text-[13px] font-normal text-muted-foreground"
          >
            {title}
          </h3>
          {/* W10 T8: pre-mounted polite live region — the headline recomputes
              while the user edits the open rail; MUST survive every restyle. */}
          <div
            role="status"
            id={`${id}-headline`}
            data-testid={cardId ? `${id}-headline` : undefined}
            className="min-w-0 truncate text-xl font-semibold tabular-nums sm:text-2xl"
          >
            {/* W16 review: one ScenarioBar edit recomputes several card
                headlines at once — without attribution AT hears context-free
                figures ("38.3 years", "77%", a bare currency). The card name
                rides INSIDE the status region as sr-only text so every
                announcement is attributed; the visible headline is unchanged
                and the bar itself stays non-live (cards own announcements). */}
            {resolvedTitleText ? (
              <span className="sr-only">{resolvedTitleText}: </span>
            ) : null}
            {headline}
          </div>
          <p
            data-testid={`${id}-meaning`}
            className="min-w-0 truncate text-sm text-muted-foreground"
          >
            {dirty && (
              <>
                <span className="sr-only">Scenario values — differ from your Inputs data. </span>
                <span aria-hidden="true" className="font-medium">Scenario: </span>
              </>
            )}
            {meaning}
          </p>
        </div>
        {open && shell && cardId && (
          <div className="absolute right-3 top-3 z-10 flex items-center gap-1">
            <div className="relative">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMenuOpen((v) => !v)}
                aria-expanded={menuOpen}
                aria-haspopup="dialog"
                aria-label={resolvedTitleText ? `${resolvedTitleText} card options` : 'Card options'}
              >
                <MoreHorizontalIcon className="h-4 w-4" />
              </Button>
              {menuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    aria-hidden="true"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div
                    role="dialog"
                    aria-label={resolvedTitleText ? `${resolvedTitleText} card options` : 'Card options'}
                    className="absolute right-0 top-full z-20 mt-1 w-56 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
                  >
                    {fullPagePath && (
                      <Link
                        to={fullPagePath}
                        className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted/40"
                      >
                        Open full page →
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        shell.hideCard(cardId);
                      }}
                      className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted/40"
                    >
                      Hide this card
                    </button>
                  </div>
                </>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                shell.setOpenId(null);
                triggerRef.current?.focus();
              }}
              aria-label={resolvedTitleText ? `Close ${resolvedTitleText}` : 'Close'}
              className="text-muted-foreground"
            >
              Close
            </Button>
          </div>
        )}
      </CardHeader>
      {open && (
        <CardContent
          id={`panel-${id}`}
          className="min-w-0 pt-0 motion-safe:animate-in fade-in ease-out [animation-duration:180ms]"
        >
          <div className={cn('grid min-w-0 grid-cols-1 gap-6', rail && 'lg:grid-cols-[280px_1fr]')}>
            {rail && <div className="flex min-w-0 flex-col gap-3">{rail}</div>}
            <div className="min-w-0 space-y-4">{children}</div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
