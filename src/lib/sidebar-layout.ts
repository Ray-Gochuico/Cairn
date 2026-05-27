import type { LucideIcon } from 'lucide-react';
import type { SidebarLayoutEntry } from '@/types/schema';

/**
 * Shape of one sidebar section. Mirrors `NavSection` in
 * `src/components/layout/Sidebar.tsx` — kept here as a standalone type so
 * this pure helper has no dependency on the component module.
 *
 * `icon` carries the lucide-react component (e.g. `LayoutDashboard`) so
 * the sidebar can render it with proper sizing / accessibility instead of
 * the old emoji glyph (which got blocked by some font stacks and shifted
 * vertical alignment by a couple of pixels). It must remain a *component*
 * reference, not a JSX node, so the consumer can apply size / color
 * classes at the render site.
 */
export interface SidebarNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /**
   * Optional glossary lookup key (mirrors `NavItem.glossaryTerm` in
   * `Sidebar.tsx`). The sidebar component resolves this against
   * `src/lib/glossary.ts` to surface a hover-tip for jargon-laden labels
   * like "Equity Grants" without losing the literal label.
   */
  glossaryTerm?: string;
}

export interface SidebarSectionShape {
  label: string;
  items: SidebarNavItem[];
}

/**
 * Apply the stored `app_settings.sidebar_layout` overlay to the hardcoded
 * default sections.
 *
 *   - `layout === null` → the defaults are returned untouched (the
 *     "no customization" case).
 *   - Otherwise, per section: items whose overlay entry has `hidden: true`
 *     are dropped; the surviving items are sorted by their position in the
 *     overlay array; any item not mentioned in the overlay at all is kept
 *     (visible) and appended after the sorted items. The append rule means
 *     a tab introduced in a future release shows up automatically without
 *     migrating every stored layout.
 *
 * The defaults array — including its nested `items` arrays — is never
 * mutated; fresh arrays are returned.
 */
export function applySidebarLayout(
  defaultSections: SidebarSectionShape[],
  layout: SidebarLayoutEntry[] | null,
): SidebarSectionShape[] {
  if (layout === null) return defaultSections;

  const orderByTo = new Map<string, number>();
  const hiddenByTo = new Map<string, boolean>();
  layout.forEach((entry, index) => {
    orderByTo.set(entry.to, index);
    hiddenByTo.set(entry.to, entry.hidden);
  });

  return defaultSections.map((section) => {
    const known: SidebarNavItem[] = [];
    const unknown: SidebarNavItem[] = [];
    for (const item of section.items) {
      if (!orderByTo.has(item.to)) {
        unknown.push(item);
      } else if (!hiddenByTo.get(item.to)) {
        known.push(item);
      }
    }
    known.sort(
      (a, b) => (orderByTo.get(a.to) ?? 0) - (orderByTo.get(b.to) ?? 0),
    );
    return { label: section.label, items: [...known, ...unknown] };
  });
}
