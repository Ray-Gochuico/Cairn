import type { ReactNode } from 'react';
import type { CardLayoutEntry } from '@/types/schema';

/**
 * One customizable top-level card on the Investments page. `id` is the stable
 * key persisted in app_settings.investments_card_layout. `size` lets the
 * renderer keep `compact` cards (the donuts) in their 3-up grid. `applicable`
 * false → the card is never rendered and never participates in the layout
 * (e.g. the 529 card when the user holds no 529 accounts).
 */
export interface InvestmentsCardEntry {
  id: string;
  label: string;
  size: 'wide' | 'compact';
  applicable: boolean;
  render: () => ReactNode;
}

/**
 * Apply the stored layout overlay to the card registry. Mirrors
 * applySidebarLayout:
 *   - non-applicable cards are dropped first (never shown, never counted);
 *   - layout === null → applicable registry order, all visible;
 *   - otherwise order applicable cards by their index in `layout`, drop those
 *     marked hidden, and append any applicable card absent from `layout` (so a
 *     card added in a future release shows up without migrating stored layouts).
 * The registry is never mutated.
 */
export function applyCardLayout(
  registry: InvestmentsCardEntry[],
  layout: CardLayoutEntry[] | null,
): InvestmentsCardEntry[] {
  const applicable = registry.filter((c) => c.applicable);
  if (layout === null) return applicable;

  const orderById = new Map<string, number>();
  const hiddenById = new Map<string, boolean>();
  layout.forEach((entry, index) => {
    orderById.set(entry.id, index);
    hiddenById.set(entry.id, entry.hidden);
  });

  const known: InvestmentsCardEntry[] = [];
  const unknown: InvestmentsCardEntry[] = [];
  for (const card of applicable) {
    if (!orderById.has(card.id)) {
      unknown.push(card);
    } else if (!hiddenById.get(card.id)) {
      known.push(card);
    }
  }
  known.sort((a, b) => (orderById.get(a.id) ?? 0) - (orderById.get(b.id) ?? 0));
  return [...known, ...unknown];
}
