import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTickersStore } from '@/stores/tickers-store';
import { TickerSchema, AssetClass, Direction } from '@/types/schema';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';

// ─── constants ────────────────────────────────────────────────────────────────

const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  US_TOTAL_MARKET: 'US Total Market',
  US_LARGE_CAP: 'US Large Cap',
  US_MID_CAP: 'US Mid Cap',
  US_SMALL_CAP: 'US Small Cap',
  INTL_DEVELOPED: 'Intl Developed',
  EMERGING_MARKETS: 'Emerging Markets',
  US_BONDS: 'US Bonds',
  INTL_BONDS: 'Intl Bonds',
  TIPS: 'TIPS',
  REAL_ESTATE: 'Real Estate',
  COMMODITIES: 'Commodities',
  CRYPTO: 'Crypto',
  SINGLE_STOCK: 'Single Stock',
  CASH: 'Cash',
  OTHER: 'Other',
};

// ─── form schema ───────────────────────────────────────────────────────────────

// Strip defaults from the omitted schema so RHF infers concrete (non-optional) types.
const TickerFormSchema = TickerSchema.omit({ userAdded: true }).extend({
  leverageFactor: z.number().nonnegative(),
  direction: z.nativeEnum(Direction),
});
type TickerFormValues = z.infer<typeof TickerFormSchema>;

// ─── types ─────────────────────────────────────────────────────────────────────

type Mode = 'list' | 'create' | { type: 'edit'; ticker: string };

const DEFAULT_TICKER_FORM: TickerFormValues = {
  ticker: '',
  name: null,
  assetClass: AssetClass.OTHER,
  leverageFactor: 1.0,
  direction: Direction.LONG,
  accentColor: null,
  sector: null,
  industry: null,
};

// ─── inner form component ─────────────────────────────────────────────────────

interface TickerFormProps {
  /** When defined, RHF values prop syncs to this (edit mode). Undefined in create mode. */
  values?: TickerFormValues;
  onSubmit: (values: TickerFormValues) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
}

function TickerForm({ values, onSubmit, onCancel, submitLabel = 'Save' }: TickerFormProps) {
  const form = useForm<TickerFormValues>({
    resolver: zodResolver(TickerFormSchema),
    defaultValues: DEFAULT_TICKER_FORM,
    values,
  });

  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 1800);
    return () => clearTimeout(t);
  }, [justSaved]);

  const handleSubmit = async (data: TickerFormValues) => {
    setSaveError(null);
    setIsSaving(true);
    try {
      await onSubmit(data);
      setJustSaved(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const fieldErrors = Object.entries(form.formState.errors).map(([field, err]) => ({
    field,
    message: (err as { message?: string })?.message ?? 'invalid',
  }));

  const dirty = form.formState.isDirty;

  return (
    <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ticker">Ticker symbol</Label>
              <Input
                id="ticker"
                maxLength={20}
                placeholder="e.g. VTI"
                {...form.register('ticker', {
                  onChange: (e) => {
                    e.target.value = e.target.value.toUpperCase();
                  },
                  setValueAs: (v) => (typeof v === 'string' ? v.toUpperCase() : v),
                })}
              />
            </div>
            <div>
              <Label htmlFor="name">Name (optional)</Label>
              <Input
                id="name"
                maxLength={200}
                placeholder="e.g. Vanguard Total Stock Market ETF"
                {...form.register('name', {
                  setValueAs: (v) => (v === '' ? null : v),
                })}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="assetClass">Asset class</Label>
            <select
              id="assetClass"
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              {...form.register('assetClass')}
            >
              {(Object.keys(AssetClass) as AssetClass[]).map((ac) => (
                <option key={ac} value={ac}>
                  {ASSET_CLASS_LABELS[ac]}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="leverageFactor">Leverage factor</Label>
              <Input
                id="leverageFactor"
                type="number"
                step="0.1"
                min="0"
                {...form.register('leverageFactor', { valueAsNumber: true })}
              />
            </div>
            <div>
              <Label>Direction</Label>
              <div className="flex items-center gap-4 h-9">
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="radio"
                    value={Direction.LONG}
                    {...form.register('direction')}
                  />
                  LONG
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="radio"
                    value={Direction.SHORT}
                    {...form.register('direction')}
                  />
                  SHORT
                </label>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {fieldErrors.length > 0 && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive-soft-foreground">
          <div className="font-medium mb-1">Fix these before saving:</div>
          <ul className="list-disc pl-5">
            {fieldErrors.map((e) => (
              <li key={e.field}>
                <span className="font-mono">{e.field}</span>: {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {saveError && (
        <div className="text-sm text-destructive-soft-foreground">{saveError}</div>
      )}

      <div className="flex justify-end items-center gap-3">
        <span
          className="text-sm text-muted-foreground transition-opacity duration-200"
          style={{ opacity: isSaving || justSaved ? 1 : 0 }}
          aria-live="polite"
        >
          {isSaving ? 'Saving…' : justSaved ? 'Saved' : ''}
        </span>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSaving || !dirty}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

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
        <div className="space-y-2">
          {sorted.map((t) => (
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
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={!t.userAdded}
                    title={t.userAdded ? undefined : 'System ticker — cannot delete'}
                    onClick={() => handleDelete(t.ticker)}
                  >
                    Delete
                  </Button>
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
