import { useEffect, useState } from 'react';
import LeverPopoverShell from './LeverPopoverShell';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useScenariosStore } from '@/stores/scenarios-store';
import type { ReturnSchedule } from '@/lib/scenarios';

interface Props { open: boolean; onOpenChange: (n: boolean) => void }

const LOST_DECADE: Record<number, number> = {
  0: -0.09,  1: -0.12,  2: -0.22,  3:  0.29,  4:  0.11,
  5:  0.05,  6:  0.16,  7:  0.05,  8: -0.37,  9:  0.26,
};

const RECESSION_2008: Record<number, number> = { 0: -0.37, 1: 0.26 };

function pctFromDecimal(d: number): string {
  return (d * 100).toFixed(2);
}

function decimalFromPctInput(s: string): number {
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return n / 100;
}

export default function ReturnSchedulePopover({ open, onOpenChange }: Props) {
  const scenarios = useScenariosStore((s) => s.scenarios);
  const defaultReturnRate = useScenariosStore((s) => s.defaultReturnRate);
  const horizonMonths = useScenariosStore((s) => s.horizonMonths);
  const active = scenarios.find((s) => s.isActive);

  const startYear = new Date().getFullYear();
  const yearCount = Math.max(5, Math.min(40, Math.round(horizonMonths / 12)));
  const years = Array.from({ length: yearCount }, (_, i) => startYear + i);

  const [draft, setDraft] = useState<ReturnSchedule>(
    active?.leverPayload.returns ?? { defaultRate: defaultReturnRate, overrides: {} },
  );
  const [selectedYear, setSelectedYear] = useState<number>(years[0]);
  const [constantPrompt, setConstantPrompt] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(active?.leverPayload.returns ?? { defaultRate: defaultReturnRate, overrides: {} });
      setSelectedYear(years[0]);
      setConstantPrompt(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active?.leverPayload, defaultReturnRate]);

  const selectedOverride = draft.overrides[String(selectedYear)] ?? null;

  const setYearOverride = (year: number, rate: number | null) => {
    setDraft((d) => {
      const next = { ...d, overrides: { ...d.overrides } };
      if (rate === null) delete next.overrides[String(year)];
      else next.overrides[String(year)] = rate;
      return next;
    });
  };

  const applyPreset = (preset: 'constant7' | 'lostDecade' | 'recession2008') => {
    if (preset === 'constant7') {
      setDraft({ defaultRate: 0.07, overrides: {} });
      return;
    }
    if (preset === 'lostDecade') {
      const overrides: Record<string, number> = {};
      for (let i = 0; i < 10; i++) {
        overrides[String(startYear + i)] = LOST_DECADE[i];
      }
      setDraft({ defaultRate: defaultReturnRate, overrides });
      return;
    }
    if (preset === 'recession2008') {
      const overrides: Record<string, number> = {};
      for (let i = 0; i < 2; i++) {
        overrides[String(startYear + i)] = RECESSION_2008[i];
      }
      setDraft({ defaultRate: defaultReturnRate, overrides });
      return;
    }
  };

  const applyConstantCustom = () => {
    if (constantPrompt == null) return;
    const decimal = decimalFromPctInput(constantPrompt);
    setDraft({ defaultRate: decimal, overrides: {} });
    setConstantPrompt(null);
  };

  const handleApply = async () => {
    if (!active?.id) return;
    await useScenariosStore.getState().updateLever(active.id, { returns: draft });
    onOpenChange(false);
  };

  const handleReset = () =>
    setDraft(active?.leverPayload.returns ?? { defaultRate: defaultReturnRate, overrides: {} });

  const selectedDisplayValue =
    selectedOverride != null ? pctFromDecimal(selectedOverride) : pctFromDecimal(draft.defaultRate);

  return (
    <LeverPopoverShell open={open} title="Return schedule" onOpenChange={onOpenChange} onApply={handleApply} onReset={handleReset}>
      <div className="space-y-3">
        <div data-testid="returns-year-strip" className="flex flex-wrap gap-1">
          {years.map((y) => {
            const override = draft.overrides[String(y)];
            const isSelected = y === selectedYear;
            let bg = 'bg-muted';
            if (override != null) bg = override >= 0 ? 'bg-green-200' : 'bg-red-200';
            return (
              <Button
                key={y}
                size="sm"
                variant={isSelected ? 'default' : 'outline'}
                className={`h-8 min-w-[3rem] text-xs ${bg}`}
                onClick={() => setSelectedYear(y)}
                aria-label={`Year ${y}${override != null ? ` (${(override * 100).toFixed(1)}%)` : ''}`}
              >
                {y}
              </Button>
            );
          })}
        </div>

        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Label htmlFor="returns-slider" className="text-xs">{selectedYear} return (%)</Label>
            <Input
              id="returns-slider"
              type="number"
              step={0.5}
              min={-50}
              max={50}
              value={selectedDisplayValue}
              onChange={(e) => setYearOverride(selectedYear, decimalFromPctInput(e.target.value))}
              aria-label="Selected year return"
            />
          </div>
          <Button
            size="sm" variant="ghost"
            onClick={() => setYearOverride(selectedYear, null)}
            aria-label="Revert selected year to default"
          >
            ↺ Default
          </Button>
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <Button size="sm" variant="outline" onClick={() => applyPreset('constant7')}>Constant 7%</Button>
          <Button
            size="sm" variant="outline"
            onClick={() => setConstantPrompt(constantPrompt == null ? pctFromDecimal(draft.defaultRate) : null)}
          >
            Constant X%
          </Button>
          <Button size="sm" variant="outline" onClick={() => applyPreset('lostDecade')}>Lost decade (2000s)</Button>
          <Button size="sm" variant="outline" onClick={() => applyPreset('recession2008')}>Recession 2008</Button>
        </div>

        {constantPrompt != null && (
          <div className="flex items-end gap-2 pt-1" data-testid="constant-x-input">
            <div className="flex-1">
              <Label htmlFor="constant-x" className="text-xs">Set ALL years to (%)</Label>
              <Input
                id="constant-x"
                type="number"
                step={0.5}
                min={-50}
                max={50}
                value={constantPrompt}
                onChange={(e) => setConstantPrompt(e.target.value)}
                aria-label="Constant rate"
              />
            </div>
            <Button size="sm" onClick={applyConstantCustom} aria-label="Apply constant rate">Set</Button>
            <Button size="sm" variant="ghost" onClick={() => setConstantPrompt(null)} aria-label="Cancel constant rate">Cancel</Button>
          </div>
        )}
      </div>
    </LeverPopoverShell>
  );
}
