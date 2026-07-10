import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import AccountsPanel from './AccountsPanel';
import HoldingsPanel from './HoldingsPanel';
import ContributionsPanel from './ContributionsPanel';
import TickersPanel from './TickersPanel';

const PANEL_IDS = ['accounts', 'holdings', 'contributions', 'tickers'] as const;
type PanelId = (typeof PANEL_IDS)[number];

function isPanelId(v: string | null): v is PanelId {
  return v != null && (PANEL_IDS as readonly string[]).includes(v);
}

/**
 * W14 "one place per thing": the Investments Manage surface — accounts,
 * holdings, contributions, and tickers CRUD, ON the page where you analyze
 * them. Lists live here (bottom region, below the analysis cards — the calm
 * read stays on top); forms open in drawers.
 *
 * Deep link: `/investments?manage=accounts|holdings|contributions|tickers`
 * selects the sub-tab and scrolls the region into view. The `?view`
 * person-filter param coexists untouched. NOT part of the customizable card
 * registry — managing your data isn't a hideable widget.
 */
export default function ManageSurface() {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('manage');
  const active: PanelId = isPanelId(raw) ? raw : 'accounts';
  const regionRef = useRef<HTMLElement | null>(null);

  // Scroll the region into view when a ?manage deep link arrives (motion-safe;
  // jsdom has no scrollIntoView, hence the optional call).
  useEffect(() => {
    if (!raw) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
    regionRef.current?.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }, [raw]);

  const onValueChange = (value: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('manage', value);
        return next;
      },
      { replace: true },
    );
  };

  return (
    <section ref={regionRef} aria-labelledby="investments-manage-heading" className="border-t pt-6">
      <h2 id="investments-manage-heading" className="text-xl font-semibold mb-1">
        Manage
      </h2>
      <p className="text-sm text-muted-foreground mb-4">
        Add and edit the accounts, holdings, contributions, and tickers behind the analysis above.
      </p>
      <Tabs value={active} onValueChange={onValueChange}>
        <TabsList>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="holdings">Holdings</TabsTrigger>
          <TabsTrigger value="contributions">Contributions</TabsTrigger>
          <TabsTrigger value="tickers">Tickers</TabsTrigger>
        </TabsList>
        <TabsContent value="accounts" className="mt-4">
          <AccountsPanel />
        </TabsContent>
        <TabsContent value="holdings" className="mt-4">
          <HoldingsPanel />
        </TabsContent>
        <TabsContent value="contributions" className="mt-4">
          <ContributionsPanel />
        </TabsContent>
        <TabsContent value="tickers" className="mt-4">
          <TickersPanel />
        </TabsContent>
      </Tabs>
    </section>
  );
}
