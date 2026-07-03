import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useSettingsStore } from '@/stores/settings-store';
import { DEFAULT_SECTIONS } from '@/components/layout/Sidebar';
import type { TailoringResult, TailorTab, TailorCalc } from '@/lib/onboarding-tailoring';
import type { SidebarLayoutEntry, CardLayoutEntry } from '@/types/schema';

// The one tab the user must never hide — keep it visible in the overlay
// regardless of any (it should never produce a) row. Mirrors
// SidebarSection.tsx's NON_HIDEABLE rule so the two write paths agree.
const NON_HIDEABLE = '/settings';

// The complete calculator-card id set (mirrors CARD_IDS in
// CalculatorsLayout.tsx). The overlay we persist must list all 12 so the
// DB field is a full snapshot, not a sparse patch.
const ALL_CALC_IDS = [
  'paycheck',
  'bonus-tax',
  'commission-tax',
  'overtime',
  'financial-independence',
  'coast-fi',
  'compound-interest',
  'debt-payoff',
  'equity',
  'retirement-401k-withdrawal',
  'backtest',
  'contribution-allocator',
] as const;

export interface TailorStepProps {
  result: TailoringResult;
  /** N for the "Step 2 of N" indicator (resolved by the controller). */
  totalSteps?: number;
  onDone: () => void;
  onSkip: () => void;
}

export function TailorStep({ result, totalSteps = 3, onDone, onSkip }: TailorStepProps) {
  // Per-row visibility, seeded from the controller's recommendation. Keyed
  // by tab `to` and calc `id` so toggles are independent and stable.
  const [tabVisible, setTabVisible] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(result.tabs.map((t) => [t.to, t.visible])),
  );
  const [calcVisible, setCalcVisible] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(result.calculators.map((c) => [c.id, c.visible])),
  );

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const update = useSettingsStore((s) => s.update);

  // Build a COMPLETE sidebar overlay: every DEFAULT_SECTIONS tab, in order
  // (same flat-map recipe as SidebarSection.writeLayout). A tab the Tailor
  // listed is hidden:!visible; /settings is force-visible; any other tab
  // (the "core" set) is hidden:false.
  const buildSidebarLayout = (): SidebarLayoutEntry[] =>
    DEFAULT_SECTIONS.flatMap((section) =>
      section.items.map((item): SidebarLayoutEntry => {
        if (item.to === NON_HIDEABLE) return { to: item.to, hidden: false };
        if (item.to in tabVisible) {
          return { to: item.to, hidden: !tabVisible[item.to] };
        }
        return { to: item.to, hidden: false };
      }),
    );

  // Build a COMPLETE calc-card overlay for all 12 ids. A listed calc is
  // hidden:!visible; an unlisted (always-shown) calc defaults visible.
  const buildCalcLayout = (): CardLayoutEntry[] =>
    ALL_CALC_IDS.map((id): CardLayoutEntry => ({
      id,
      hidden: id in calcVisible ? !calcVisible[id] : false,
    }));

  const handleDone = async () => {
    setSaving(true);
    setSaveError(false);
    try {
      await update({
        sidebarLayout: buildSidebarLayout(),
        calculatorCardLayout: buildCalcLayout(),
      });
      onDone();
    } catch {
      // settings-store.update() rethrows on failure — surface inline retry
      // and stay on the screen (never advance the flow on a failed write).
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  const tabRows = useMemo(() => result.tabs, [result.tabs]);
  const calcRows = useMemo(() => result.calculators, [result.calculators]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Step 2 of {totalSteps}
          </div>
          <CardTitle>Tailor your app</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Hidden tabs/tools aren't deleted — flip any row on, or restore later in
            Settings.
          </p>

          {tabRows.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                Tabs · from your data
              </div>
              <ul className="space-y-1">
                {tabRows.map((tab: TailorTab) => (
                  <li
                    key={tab.to}
                    className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm"
                  >
                    <div className="flex-1">
                      <div className={tabVisible[tab.to] ? '' : 'text-muted-foreground line-through'}>
                        {tab.label}
                      </div>
                      <div className="text-sm text-muted-foreground">{tab.reason}</div>
                    </div>
                    <Switch
                      aria-label={tab.label}
                      checked={tabVisible[tab.to]}
                      onCheckedChange={(on) =>
                        setTabVisible((prev) => ({ ...prev, [tab.to]: on }))
                      }
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {calcRows.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                Calculators
              </div>
              <ul className="space-y-1">
                {calcRows.map((calc: TailorCalc) => (
                  <li
                    key={calc.id}
                    className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm"
                  >
                    <div className="flex-1">
                      <div className={calcVisible[calc.id] ? '' : 'text-muted-foreground line-through'}>
                        {calc.label}
                      </div>
                      <div className="text-sm text-muted-foreground">{calc.reason}</div>
                    </div>
                    <Switch
                      aria-label={calc.label}
                      checked={calcVisible[calc.id]}
                      onCheckedChange={(on) =>
                        setCalcVisible((prev) => ({ ...prev, [calc.id]: on }))
                      }
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {saveError && (
            <div role="alert" className="rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive-soft-foreground">
              Couldn't save your choices. Please try again.
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onSkip} disabled={saving}>
              Skip
            </Button>
            <Button onClick={handleDone} disabled={saving}>
              {saveError ? 'Try again' : 'Done'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
