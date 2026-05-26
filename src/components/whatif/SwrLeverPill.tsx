import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface SwrLeverPillProps {
  swrOverride: number | null;
  householdWithdrawalRate: number;
  onChange: (next: number | null) => void;
}

/**
 * 7th lever pill — per-scenario Safe Withdrawal Rate override. When
 * override is null, displays the household withdrawalRate as a muted
 * "using default" value. When set, displays the override at full weight
 * with a reset button.
 */
export default function SwrLeverPill({
  swrOverride,
  householdWithdrawalRate,
  onChange,
}: SwrLeverPillProps) {
  const usingDefault = swrOverride == null;
  const effective = usingDefault ? householdWithdrawalRate : swrOverride;
  const displayPct = (effective * 100).toFixed(1);

  const [draft, setDraft] = useState<string>(displayPct);

  // Sync local input when the override or household value changes externally
  // (e.g., scenario switch, household edit, or reset click).
  useEffect(() => {
    setDraft(displayPct);
  }, [displayPct]);

  const commit = (raw: string) => {
    if (raw.trim() === '') return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const fraction = n / 100;
    if (fraction < 0.005 || fraction > 0.15) return;
    onChange(fraction);
  };

  return (
    <div
      className={`flex items-center gap-2 rounded-md border px-3 py-2 ${
        usingDefault ? 'opacity-70 italic' : ''
      }`}
      data-testid="swr-lever-pill"
      data-using-default={usingDefault ? 'true' : 'false'}
      title="Safe Withdrawal Rate — annual % of your retirement portfolio you can withdraw"
    >
      <Label htmlFor="swr-lever-input" className="text-xs text-muted-foreground">
        SWR
      </Label>
      <Input
        id="swr-lever-input"
        type="number"
        step="0.1"
        min={0.5}
        max={15}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        aria-label="SWR percent"
        className="h-8 w-16 tabular-nums"
      />
      <span className="text-xs text-muted-foreground">%</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        disabled={usingDefault}
        onClick={() => onChange(null)}
        aria-label="Reset SWR to household default"
        title="Reset to household default"
      >
        <RotateCcw className="h-3 w-3" />
      </Button>
    </div>
  );
}
