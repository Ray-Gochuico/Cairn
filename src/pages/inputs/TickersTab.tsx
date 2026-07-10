import { useEffect, useMemo, useState } from 'react';
import { useTickersStore } from '@/stores/tickers-store';
import { Direction } from '@/types/schema';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import TickerForm, {
  ASSET_CLASS_LABELS,
  type TickerFormValues,
} from '@/components/forms/TickerForm';

// ─── types ─────────────────────────────────────────────────────────────────────

type Mode = 'list' | 'create' | { type: 'edit'; ticker: string };

// W14: the inline ticker form was extracted to
// src/components/forms/TickerForm.tsx (with form-errors adoption) so the
// Investments Manage surface can mount it in an EditDrawer.

// ─── main tab component ───────────────────────────────────────────────────────

export default function TickersTab() {
  const { tickers, isLoading, error, load, upsert, remove } = useTickersStore();
  const { confirm, dialog } = useConfirm();
  const [mode, setMode] = useState<Mode>('list');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, [load]);

  // Stale-edit-target reset: if the edited ticker disappears, fall back to list.
  useEffect(() => {
    if (typeof mode === 'object' && mode.type === 'edit') {
      if (!tickers.some((t) => t.ticker === mode.ticker)) {
        setMode('list');
      }
    }
  }, [mode, tickers]);

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

  // ── Create mode ────────────────────────────────────────────────────────────

  if (mode === 'create') {
    return (
      <div className="p-6 max-w-2xl">
        <h2 className="text-2xl font-semibold mb-1">New ticker</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Add a ticker with its asset class and leverage metadata.
        </p>
        <TickerForm
          submitLabel="Create"
          onSubmit={async (v) => {
            await upsert({ ...v, userAdded: true });
            setMode('list');
          }}
          onCancel={() => setMode('list')}
        />
      </div>
    );
  }

  // ── Edit mode ──────────────────────────────────────────────────────────────

  if (typeof mode === 'object' && mode.type === 'edit') {
    const target = tickers.find((t) => t.ticker === mode.ticker);
    if (!target) {
      // Effect above will reset mode to 'list' on the next tick.
      return null;
    }

    const formValues: TickerFormValues = {
      ticker: target.ticker,
      name: target.name,
      assetClass: target.assetClass,
      leverageFactor: target.leverageFactor,
      direction: target.direction,
      accentColor: target.accentColor,
      sector: target.sector,
      industry: target.industry,
    };

    return (
      <div className="p-6 max-w-2xl">
        <h2 className="text-2xl font-semibold mb-1">Edit ticker</h2>
        <p className="text-sm text-muted-foreground mb-4">
          {target.userAdded ? 'User-added ticker.' : 'System ticker — edits allowed, but delete is restricted.'}
        </p>
        <TickerForm
          values={formValues}
          submitLabel="Save"
          onSubmit={async (v) => {
            await upsert({ ...v, userAdded: target.userAdded });
            setMode('list');
          }}
          onCancel={() => setMode('list')}
        />
      </div>
    );
  }

  // ── List mode ──────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-2xl font-semibold">Tickers</h2>
        <Button onClick={() => setMode('create')}>New ticker</Button>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Asset class and leverage overrides for every ticker in your holdings.
        User-added rows appear first.
      </p>

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
                    onClick={() => setMode({ type: 'edit', ticker: t.ticker })}
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
      {dialog}
    </div>
  );
}
