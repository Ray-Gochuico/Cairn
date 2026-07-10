import { useEffect, useMemo, useState } from 'react';
import { useTickersStore } from '@/stores/tickers-store';
import { Direction } from '@/types/schema';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { EditDrawer } from '@/components/layout/EditDrawer';
import TickerForm, {
  ASSET_CLASS_LABELS,
  type TickerFormValues,
} from '@/components/forms/TickerForm';

/**
 * W14 Manage surface: ticker CRUD on the Investments page. A near-mechanical
 * port of the retired TickersTab — string-keyed upsert, dense rows, sticky
 * search + polite count (round-3 S8), and the omitted system-row delete all
 * carried VERBATIM — with the tab's full-page mode swap replaced by an
 * EditDrawer mounting the extracted TickerForm.
 */
export default function TickersPanel() {
  const { tickers, isLoading, error, load, upsert, remove } = useTickersStore();
  const { confirm, dialog } = useConfirm();
  const [drawer, setDrawer] = useState<'closed' | 'create' | { type: 'edit'; ticker: string }>('closed');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, [load]);

  // Sort: userAdded DESC, ticker ASC
  const sorted = [...tickers].sort((a, b) => {
    if (a.userAdded !== b.userAdded) return a.userAdded ? -1 : 1;
    return a.ticker.localeCompare(b.ticker);
  });

  // W10 design: 286 tickers is a wall — a sticky search filters by symbol or name.
  const [query, setQuery] = useState('');
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (t) => t.ticker.toLowerCase().includes(q) || (t.name ?? '').toLowerCase().includes(q),
    );
  }, [sorted, query]);

  const handleDelete = async (ticker: string) => {
    setDeleteError(null);
    const ok = await confirm({
      title: `Delete ${ticker}?`,
      description:
        'This removes the ticker and its asset-class / leverage metadata. Any holding that uses this symbol will be left without ticker details. This can’t be undone.',
    });
    if (!ok) return;
    try {
      await remove(ticker);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Failed to delete');
    }
  };

  // Open derives from `editing != null` in edit mode, so a ticker deleted out
  // from under an open drawer closes it safely (Task-2 recipe).
  const editing = typeof drawer === 'object' ? tickers.find((t) => t.ticker === drawer.ticker) : undefined;
  const drawerOpen = drawer === 'create' || editing != null;

  const editingValues: TickerFormValues | undefined = editing
    ? {
        ticker: editing.ticker,
        name: editing.name,
        assetClass: editing.assetClass,
        leverageFactor: editing.leverageFactor,
        direction: editing.direction,
        accentColor: editing.accentColor,
        sector: editing.sector,
        industry: editing.industry,
      }
    : undefined;

  return (
    <div className="max-w-3xl">
      <div className="flex items-start justify-between gap-3 mb-4">
        <p className="text-sm text-muted-foreground">
          Asset class and leverage overrides for every ticker in your holdings.
          User-added rows appear first.
        </p>
        <Button size="sm" className="shrink-0" onClick={() => setDrawer('create')}>New ticker</Button>
      </div>

      {isLoading && (
        <div className="text-sm text-muted-foreground">Loading…</div>
      )}

      {error && (
        <div className="text-sm text-destructive-soft-foreground mb-4">{error}</div>
      )}

      {deleteError && (
        <div className="text-sm text-destructive-soft-foreground mb-4">{deleteError}</div>
      )}

      {!isLoading && sorted.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No tickers yet. Add one above or import holdings.
          </CardContent>
        </Card>
      )}

      {sorted.length > 0 && (
        <div className="sticky top-0 z-10 -mx-1 bg-background px-1 py-2 mb-2">
          <Input
            type="search"
            role="searchbox"
            aria-label="Search tickers"
            placeholder={`Search ${sorted.length} tickers…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {/* Round-3 S8: a polite live count so AT users hear the filter work. */}
          <p
            data-testid="tickers-visible-count"
            aria-live="polite"
            className="mt-1 text-xs text-muted-foreground"
          >
            {visible.length} of {sorted.length} tickers
          </p>
        </div>
      )}

      {/* Round-3 S8: a search that matches nothing used to render NOTHING
          below the box — name the dead end. */}
      {!isLoading && sorted.length > 0 && visible.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No tickers match &ldquo;{query.trim()}&rdquo;. Try a different symbol or name.
          </CardContent>
        </Card>
      )}

      {visible.length > 0 && (
        <div className="space-y-2">
          {visible.map((t) => (
            <Card key={t.ticker} data-testid="tickers-row">
              <CardContent className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-bold font-mono truncate">{t.ticker}</span>
                    <span
                      className={`shrink-0 text-xs px-1.5 py-0.5 rounded font-medium ${
                        t.direction === Direction.SHORT
                          ? 'bg-destructive/15 text-destructive-soft-foreground'
                          : 'bg-success-soft text-success-foreground'
                      }`}
                    >
                      {t.direction}
                    </span>
                  </div>
                  <div
                    className="text-xs text-muted-foreground mt-0.5 truncate"
                    title={[
                      t.name,
                      ASSET_CLASS_LABELS[t.assetClass],
                      `${t.leverageFactor.toFixed(1)}x`,
                      !t.userAdded ? 'system' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  >
                    {t.name && <span>{t.name} · </span>}
                    {ASSET_CLASS_LABELS[t.assetClass]}
                    {' · '}
                    {t.leverageFactor.toFixed(1)}x
                    {!t.userAdded && ' · system'}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDrawer({ type: 'edit', ticker: t.ticker })}
                  >
                    Edit
                  </Button>
                  {/* W10 design: system rows drop the dead Delete entirely —
                      the "· system" suffix already explains the row. */}
                  {t.userAdded && (
                    <Button
                      size="sm"
                      variant="destructive"
                      aria-label={`Delete ${t.ticker}`}
                      onClick={() => handleDelete(t.ticker)}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <EditDrawer
        open={drawerOpen}
        onClose={() => setDrawer('closed')}
        title={editing ? 'Edit ticker' : 'New ticker'}
        description={
          editing
            ? editing.userAdded
              ? 'User-added ticker.'
              : 'System ticker — edits allowed, but delete is restricted.'
            : 'Add a ticker with its asset class and leverage metadata.'
        }
      >
        <TickerForm
          values={editingValues}
          submitLabel={editing ? 'Save' : 'Create'}
          onSubmit={async (v) => {
            await upsert({ ...v, userAdded: editing ? editing.userAdded : true });
            setDrawer('closed');
          }}
          onCancel={() => setDrawer('closed')}
        />
      </EditDrawer>
      {dialog}
    </div>
  );
}
