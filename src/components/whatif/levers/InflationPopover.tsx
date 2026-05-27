import { useEffect, useState } from 'react';
import LeverPopoverShell from './LeverPopoverShell';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useScenariosStore } from '@/stores/scenarios-store';
import { useHouseholdStore } from '@/stores/household-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { InflationSchedule } from '@/lib/scenarios';
import { effectiveBaselineInflation } from '@/lib/scenarios';

interface Props { open: boolean; onOpenChange: (n: boolean) => void }

function pctFromDecimal(d: number): string {
  return (d * 100).toFixed(2);
}

function decimalFromPctInput(s: string): number {
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return n / 100;
}

/**
 * Per-scenario inflation override popover (Task #15).
 *
 * Mirrors {@link ReturnSchedulePopover}: per-scenario default rate +
 * per-year overrides arranged in a year strip. The popover never reaches
 * into Zustand directly — it reads the active scenario and updates the
 * `inflation` field of leverPayload through `updateLever`.
 *
 * Precedence visible to the user:
 *   - "Default inflation (this scenario)" blank ⇒ household / settings fallback.
 *   - Year-strip cells either green (override > default), red (override <
 *     default), or muted (no override).
 */
export default function InflationPopover({ open, onOpenChange }: Props) {
  const scenarios = useScenariosStore((s) => s.scenarios);
  const horizonMonths = useScenariosStore((s) => s.horizonMonths);
  const active = scenarios.find((s) => s.isActive);

  const household = useHouseholdStore((s) => s.household);
  const settings = useSettingsStore((s) => s.settings);

  const startYear = new Date().getFullYear();
  const yearCount = Math.max(5, Math.min(40, Math.round(horizonMonths / 12)));
  const years = Array.from({ length: yearCount }, (_, i) => startYear + i);

  // The effective fallback (what the user sees when defaultRate is null).
  const fallbackInflation = effectiveBaselineInflation(
    active ?? null,
    household,
    settings,
  );

  const [draft, setDraft] = useState<InflationSchedule>(
    active?.leverPayload.inflation ?? { defaultRate: null, overrides: {} },
  );
  const [selectedYear, setSelectedYear] = useState<number>(years[0]);
  const [defaultStr, setDefaultStr] = useState<string>(
    active?.leverPayload.inflation?.defaultRate != null
      ? pctFromDecimal(active.leverPayload.inflation.defaultRate)
      : '',
  );

  // Re-sync when popover opens or active scenario changes.
  useEffect(() => {
    if (open) {
      const current =
        active?.leverPayload.inflation ?? { defaultRate: null, overrides: {} };
      setDraft(current);
      setSelectedYear(years[0]);
      setDefaultStr(current.defaultRate != null ? pctFromDecimal(current.defaultRate) : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active?.leverPayload]);

  const selectedOverride = draft.overrides[String(selectedYear)] ?? null;

  const setYearOverride = (year: number, rate: number | null) => {
    setDraft((d) => {
      const next = { ...d, overrides: { ...d.overrides } };
      if (rate === null) delete next.overrides[String(year)];
      else next.overrides[String(year)] = rate;
      return next;
    });
  };

  const handleApply = async () => {
    if (!active?.id) return;
    const defaultRateDecimal =
      defaultStr.trim() === '' ? null : Number(defaultStr) / 100;
    await useScenariosStore.getState().updateLever(active.id, {
      inflation: { ...draft, defaultRate: defaultRateDecimal },
    });
    onOpenChange(false);
  };

  const handleReset = () => {
    const base = active?.leverPayload.inflation ?? { defaultRate: null, overrides: {} };
    setDraft(base);
    setDefaultStr(base.defaultRate != null ? pctFromDecimal(base.defaultRate) : '');
  };

  // For the year-strip color logic: a year is "tinted" if the override
  // differs from the effective fallback. We use the resolved fallback (which
  // already accounts for household and settings) as the reference point.
  const referenceRate =
    draft.defaultRate != null ? draft.defaultRate : fallbackInflation;

  const selectedDisplayValue =
    selectedOverride != null
      ? pctFromDecimal(selectedOverride)
      : pctFromDecimal(referenceRate);

  return (
    <LeverPopoverShell
      open={open}
      title="Inflation schedule"
      onOpenChange={onOpenChange}
      onApply={handleApply}
      onReset={handleReset}
    >
      <div className="space-y-3">
        <div>
          <Label htmlFor="inflation-default" className="text-xs">
            Default inflation (this scenario) (%)
          </Label>
          <Input
            id="inflation-default"
            aria-label="Default inflation (this scenario)"
            type="number"
            step={0.1}
            min={-5}
            max={20}
            value={defaultStr}
            onChange={(e) => setDefaultStr(e.target.value)}
            placeholder={pctFromDecimal(fallbackInflation)}
            className="mt-1 w-32"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Leave blank to use the household / app default ({pctFromDecimal(fallbackInflation)}%).
          </p>
        </div>

        <div data-testid="inflation-year-strip" className="flex flex-wrap gap-1 pt-2">
          {years.map((y) => {
            const override = draft.overrides[String(y)];
            const isSelected = y === selectedYear;
            let bg = 'bg-muted';
            if (override != null) {
              bg = override >= referenceRate ? 'bg-warning/30' : 'bg-info/30';
            }
            return (
              <Button
                key={y}
                size="sm"
                variant={isSelected ? 'default' : 'outline'}
                className={`h-8 min-w-[3rem] text-xs ${bg}`}
                onClick={() => setSelectedYear(y)}
                aria-label={`Year ${y}${
                  override != null ? ` (${(override * 100).toFixed(1)}%)` : ''
                }`}
              >
                {y}
              </Button>
            );
          })}
        </div>

        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Label htmlFor="inflation-year-input" className="text-xs">
              {selectedYear} inflation (%)
            </Label>
            <Input
              id="inflation-year-input"
              type="number"
              step={0.1}
              min={-5}
              max={20}
              value={selectedDisplayValue}
              onChange={(e) => setYearOverride(selectedYear, decimalFromPctInput(e.target.value))}
              aria-label="Selected year inflation"
            />
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setYearOverride(selectedYear, null)}
            aria-label="Revert selected year to default"
          >
            ↺ Default
          </Button>
        </div>
      </div>
    </LeverPopoverShell>
  );
}
