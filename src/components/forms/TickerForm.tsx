import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { TickerSchema, AssetClass, Direction } from '@/types/schema';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { FieldError, FormErrorSummary, useFormSubmit } from './form-errors';

export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
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

// Strip defaults from the omitted schema so RHF infers concrete (non-optional) types.
const TickerFormSchema = TickerSchema.omit({ userAdded: true }).extend({
  leverageFactor: z.number().nonnegative(),
  direction: z.nativeEnum(Direction),
});
export type TickerFormValues = z.infer<typeof TickerFormSchema>;

export const DEFAULT_TICKER_FORM: TickerFormValues = {
  ticker: '',
  name: null,
  assetClass: AssetClass.OTHER,
  leverageFactor: 1.0,
  direction: Direction.LONG,
  accentColor: null,
  sector: null,
  industry: null,
};

export interface TickerFormProps {
  /** When defined, RHF values prop syncs to this (edit mode). Undefined in create mode. */
  values?: TickerFormValues;
  onSubmit: (values: TickerFormValues) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
}

/**
 * Standalone ticker form (W14: extracted from TickersTab so the Investments
 * Manage surface can mount it in an EditDrawer). Keeps the tab's string-keyed
 * `values`-sync edit contract; adopts the Wave-10 form-errors primitives —
 * a rejected upsert lands in the summary via useFormSubmit.
 */
export default function TickerForm({ values, onSubmit, onCancel, submitLabel = 'Save' }: TickerFormProps) {
  const form = useForm<TickerFormValues>({
    resolver: zodResolver(TickerFormSchema),
    defaultValues: DEFAULT_TICKER_FORM,
    values,
  });

  const { onValid, submitting, submitError } = useFormSubmit(onSubmit);

  const dirty = form.formState.isDirty;

  return (
    <form onSubmit={form.handleSubmit(onValid)} className="space-y-4">
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
                aria-invalid={form.formState.errors.ticker ? true : undefined}
                aria-describedby={form.formState.errors.ticker ? 'ticker-symbol-error' : undefined}
              />
              <FieldError id="ticker-symbol-error" message={form.formState.errors.ticker?.message} />
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
                aria-invalid={form.formState.errors.name ? true : undefined}
                aria-describedby={form.formState.errors.name ? 'ticker-name-error' : undefined}
              />
              <FieldError id="ticker-name-error" message={form.formState.errors.name?.message} />
            </div>
          </div>

          <div>
            <Label htmlFor="assetClass">Asset class</Label>
            <select
              id="assetClass"
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              {...form.register('assetClass')}
              aria-invalid={form.formState.errors.assetClass ? true : undefined}
              aria-describedby={form.formState.errors.assetClass ? 'ticker-asset-class-error' : undefined}
            >
              {(Object.keys(AssetClass) as AssetClass[]).map((ac) => (
                <option key={ac} value={ac}>
                  {ASSET_CLASS_LABELS[ac]}
                </option>
              ))}
            </select>
            <FieldError id="ticker-asset-class-error" message={form.formState.errors.assetClass?.message} />
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
                aria-invalid={form.formState.errors.leverageFactor ? true : undefined}
                aria-describedby={form.formState.errors.leverageFactor ? 'ticker-leverage-error' : undefined}
              />
              <FieldError id="ticker-leverage-error" message={form.formState.errors.leverageFactor?.message} />
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
              <FieldError id="ticker-direction-error" message={form.formState.errors.direction?.message} />
            </div>
          </div>
        </CardContent>
      </Card>

      <FormErrorSummary
        fieldErrors={form.formState.errors}
        submitError={submitError}
        labels={{
          ticker: 'Ticker symbol',
          assetClass: 'Asset class',
          leverageFactor: 'Leverage factor',
        }}
      />

      <div className="flex justify-end items-center gap-3">
        <span
          className="text-sm text-muted-foreground transition-opacity duration-200"
          style={{ opacity: submitting ? 1 : 0 }}
          aria-live="polite"
        >
          Saving…
        </span>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting || !dirty}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
