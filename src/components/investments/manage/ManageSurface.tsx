import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import AccountsPanel from './AccountsPanel';
import HoldingsPanel from './HoldingsPanel';
import ContributionsPanel from './ContributionsPanel';
import TickersPanel from './TickersPanel';
import { scrollIntoViewWhenSettled } from '@/lib/scroll-into-view-settled';
import { cn } from '@/lib/utils';

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
  // The last ?manage value THIS surface wrote (review MINOR 3). The tab strip
  // below writes the param on every click, so without it the arrival effect
  // cannot tell a deep link from the user's own click.
  const selfWroteRef = useRef<string | null>(null);

  // Scroll the region into view when a ?manage deep link ARRIVES — AFTER the
  // analysis cards above have finished laying out (C1, smoke M3 2026-09-02:
  // the mount-time scroll landed, then Recharts' async measurement grew the
  // cards above and pushed the region back below the fold — the
  // CalculatorsLayout deep-link class). Motion-safe + jsdom-safe inside;
  // cleanup cancels the poll if the surface unmounts mid-settle.
  //
  // Review MINOR 3: an ARRIVAL is the param the surface mounted with, or one
  // written from OUTSIDE it (Investments.tsx:218-229 `openManage` — the "Add
  // an account" / "Add a ticker" deflections from the cards above). A click
  // on the tab strip inside the region is NOT an arrival: the user is already
  // here, and the settle loop would jump the region to its start >=150ms (up
  // to 500ms while the panel lays out) after the click — after they had
  // started reading, fighting their own scroll. So the surface skips the
  // value it wrote itself, and nothing else.
  useEffect(() => {
    if (!raw) return;
    if (selfWroteRef.current === raw) return;
    return scrollIntoViewWhenSettled(() => regionRef.current, 'start');
  }, [raw]);

  const onValueChange = (value: string) => {
    selfWroteRef.current = value;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('manage', value);
        return next;
      },
      { replace: true },
    );
  };

  // A-11(4) (v1.7.1): the settle-scroll above lands the region's top at the
  // scroller's top (block:'start'), which needs at least a viewport of page
  // below it — a short panel (the seeded Contributions at 1024×700) left the
  // scroll at the container floor, 287 px short of flush (C1 smoke). While
  // ?manage is in the URL (the same `raw` that arms the scroll) the region
  // is at least one viewport tall. The tab strip writes ?manage too, so after
  // a tab click the floor stays on and a short panel cannot shrink the
  // scroller under the user; a plain visit keeps its natural height until then.
  return (
    <section
      ref={regionRef}
      aria-labelledby="investments-manage-heading"
      className={cn('border-t pt-6', raw && 'min-h-screen')}
    >
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
