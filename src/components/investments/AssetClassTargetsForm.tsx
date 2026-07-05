import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AssetClass } from '@/types/enums';
import type { AssetClassTarget } from '@/types/schema';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { NumberField } from '@/components/calculators/NumberField';
import { validateClassTargets } from '@/lib/allocation-hierarchy';

const ASSET_CLASS_LABEL: Record<AssetClass, string> = {
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

export interface AssetClassTargetsFormProps {
  /** Classes the user actually holds (derive from held tickers' asset_class). */
  heldClasses: AssetClass[];
  initial: AssetClassTarget[] | null;
  onSave: (targets: AssetClassTarget[]) => Promise<void>;
}

export function AssetClassTargetsForm({ heldClasses, initial, onSave }: AssetClassTargetsFormProps) {
  // whole-percent state per class (null = blank).
  const initialPct = useMemo(() => {
    const m = new Map<AssetClass, number | null>();
    for (const c of heldClasses) m.set(c, null);
    for (const t of initial ?? []) if (m.has(t.assetClass)) m.set(t.assetClass, t.targetPct * 100);
    return m;
  }, [heldClasses, initial]);

  const [pct, setPct] = useState<Map<AssetClass, number | null>>(initialPct);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const sumWhole = [...pct.values()].reduce<number>((a, v) => a + (v ?? 0), 0);

  const handleSave = async () => {
    const targets: AssetClassTarget[] = [...pct.entries()]
      .filter(([, v]) => v != null && v > 0)
      .map(([assetClass, v]) => ({ assetClass, targetPct: (v as number) / 100 }));
    const check = validateClassTargets(targets);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave(targets);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Asset-class targets</CardTitle>
        <CardDescription>
          Your strategic mix across asset classes (household-level). Per-holding
          targets refine within each class. Only classes you hold are shown.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {heldClasses.map((cls) => (
            <NumberField
              key={cls}
              id={`class-target-${cls}`}
              label={ASSET_CLASS_LABEL[cls]}
              ariaLabel={`${ASSET_CLASS_LABEL[cls]} target`}
              value={pct.get(cls) ?? null}
              onChange={(v) => setPct((prev) => new Map(prev).set(cls, v))}
              suffix="%"
              step="1"
              min={0}
            />
          ))}
        </div>
        <div className="text-sm text-muted-foreground">
          Running total:{' '}
          <span
            data-testid="class-targets-sum"
            // Design M2: use the -foreground token (emerald-700) for readable
            // contrast on the light card surface — bare `text-success` is the
            // saturated chart green and fails contrast as text.
            className={`tabular-nums font-medium ${
              sumWhole > 100 ? 'text-destructive-soft-foreground' : sumWhole === 100 ? 'text-success-foreground' : ''
            }`}
          >
            {sumWhole.toFixed(0)}%
          </span>{' '}
          of 100%
        </div>
        {error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive-soft-foreground"
          >
            {error}
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save targets'}
          </Button>
          {/* UX H1: reciprocal bridge to the allocator card on Calculators. */}
          <Link to="/calculators" className="text-sm text-primary hover:underline">
            Allocate a contribution →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
