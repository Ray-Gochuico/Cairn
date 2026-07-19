import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NumberField } from '@/components/calculators/NumberField';
import { Button } from '@/components/ui/button';
import { useScenarioAssumptions } from '@/lib/calculators/use-scenario-assumptions';
import type { ScenarioField } from '@/lib/calculators/scenario-assumptions';
import { useHouseholdTaxContext } from '@/lib/calculators/use-household-tax-context';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useScenariosStore } from '@/stores/scenarios-store';
import { leverPayloadFromScenarioBar } from '@/lib/whatif/from-scenario-bar';
import { defaultScenarioColor } from '@/lib/whatif/scenario-colors';
import { localTodayISO } from '@/lib/dates';
import { formatCurrency, formatDate } from '@/lib/format';
import { prettifyCityCode } from '@/lib/jurisdiction-format';
import { InlineLink } from '@/components/calculators/InlineLink';

/**
 * Wave 16 "Basecamp spine": the shared scenario bar above the calculators
 * grid. One editable copy of the assumptions every projection card used to
 * duplicate (portfolio / contribution / expenses / return / SWR / inflation),
 * plus read-only identity chips (filing status · state · city · tax year ·
 * salary — salary editing is Wave 18, D9).
 *
 * NOT an aria-live region (owner constraint 3): each card's role="status"
 * headline (CalculatorCard, W10 T8) announces recomputed results; a live bar
 * would double-announce every keystroke. Edited state is visible TEXT
 * ("edited — reset") plus a decorative blaze dot — never color alone. The
 * blaze dot is an SVG fill of hsl(var(--blaze)) per the Wave-12 D3 token
 * discipline (fill/stroke only, never text). Not sticky (Wave-16 D6).
 */

const FILING_LABELS: Record<string, string> = {
  SINGLE: 'Single',
  MFJ: 'Married filing jointly',
  MFS: 'Married filing separately',
  HOH: 'Head of household',
};

const COMMIT_DELAY_MS = 150;

interface FieldSpec {
  field: ScenarioField;
  id: string;
  label: string;
  suffix?: string;
  step?: string;
}

const FIELDS: FieldSpec[] = [
  { field: 'portfolio', id: 'scenario-portfolio', label: 'Portfolio', suffix: '$', step: '1000' },
  { field: 'annualContribution', id: 'scenario-contribution', label: 'Annual contribution', suffix: '$/yr', step: '500' },
  { field: 'monthlyExpenses', id: 'scenario-expenses', label: 'Monthly expenses', suffix: '$/mo', step: '100' },
  { field: 'returnPct', id: 'scenario-return', label: 'Return', suffix: '%', step: '0.1' },
  { field: 'swrPct', id: 'scenario-swr', label: 'Withdrawal rate', suffix: '%', step: '0.1' },
  { field: 'inflationPct', id: 'scenario-inflation', label: 'Inflation', suffix: '%', step: '0.1' },
];

/** Decorative blaze dot — fill-only token use (Wave-12 D3), always aria-hidden. */
function BlazeDot() {
  return (
    <svg viewBox="0 0 8 8" className="h-2 w-2 shrink-0" aria-hidden="true">
      <circle cx="4" cy="4" r="3" fill="hsl(var(--blaze))" />
    </svg>
  );
}

/** Wave 18 (D14): the per-person editable salary row — the bar's exact field
 *  idiom (150ms debounced commit, "edited — reset" tag, provenance line),
 *  writing the SCENARIO layer only (constraint 5: never the persons store). */
function SalaryBarField(props: {
  id: string;
  label: string;
  committed: number;
  edited: boolean;
  onCommit: (value: number) => void;
  onReset: () => void;
}) {
  const { id, label, committed, edited, onCommit, onReset } = props;
  const [local, setLocal] = useState<number | null>(committed);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current === null) setLocal(committed);
  }, [committed]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const schedule = (v: number | null) => {
    setLocal(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      onCommit(v ?? 0);
    }, COMMIT_DELAY_MS);
  };

  const reset = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    onReset();
    document.getElementById(id)?.focus();
  };

  return (
    <div className="min-w-0">
      <NumberField
        id={id}
        label={label}
        value={local}
        onChange={schedule}
        suffix="$/yr"
        step="1000"
        min={0}
      />
      {edited ? (
        <button
          type="button"
          onClick={reset}
          aria-label={`Reset ${label} to your data`}
          className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <BlazeDot />
          edited — reset
        </button>
      ) : (
        <p className="mt-0.5 text-xs text-muted-foreground truncate">from Inputs</p>
      )}
    </div>
  );
}

function ScenarioBarField(props: {
  spec: FieldSpec;
  committed: number;
  edited: boolean;
  provenance: string;
  onCommit: (field: ScenarioField, value: number) => void;
  onReset: (field: ScenarioField) => void;
}) {
  const { spec, committed, edited, provenance, onCommit, onReset } = props;
  // Local per-keystroke echo; commits trail 150ms behind typing (D5) so the
  // heavy chart builders downstream never recompute per keystroke.
  const [local, setLocal] = useState<number | null>(committed);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // External commits (reset, another consumer) resync the echo — but never
  // mid-debounce: the user's in-flight keystrokes win.
  useEffect(() => {
    if (timer.current === null) setLocal(committed);
  }, [committed]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const schedule = (v: number | null) => {
    setLocal(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      onCommit(spec.field, v ?? 0); // blank commits as 0 (house NumberField idiom, D10)
    }, COMMIT_DELAY_MS);
  };

  const reset = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    onReset(spec.field);
    // W16 review: this button renders only while `edited` is true, so
    // activating it unmounts the focused element — hand focus to the field's
    // input instead of letting it drop to <body>.
    document.getElementById(spec.id)?.focus();
  };

  return (
    <div className="min-w-0">
      <NumberField
        id={spec.id}
        label={spec.label}
        value={local}
        onChange={schedule}
        suffix={spec.suffix}
        step={spec.step}
        min={0}
      />
      {edited ? (
        <button
          type="button"
          onClick={reset}
          aria-label={`Reset ${spec.label} to your data`}
          className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <BlazeDot />
          edited — reset
        </button>
      ) : (
        <p className="mt-0.5 text-xs text-muted-foreground truncate" title={provenance}>
          {provenance}
        </p>
      )}
    </div>
  );
}

export function ScenarioBar() {
  const household = useHouseholdStore((s) => s.household);
  const tax = useHouseholdTaxContext();
  const scenario = useScenarioAssumptions();
  const navigate = useNavigate();
  // The REAL persons (prefills + reset targets); tax.persons are effective.
  const realPersons = usePersonsStore((s) => s.persons);
  const [sendError, setSendError] = useState<string | null>(null);

  // D14: Send to What-If — pure D6 mapping, schema-parsed at the button so a
  // mapping bug fails loudly here and never persists garbage.
  const sendToWhatIf = async () => {
    const todayIso = localTodayISO();
    try {
      const leverPayload = leverPayloadFromScenarioBar(
        {
          portfolio: scenario.isEdited.portfolio ? scenario.values.portfolio : null,
          realPortfolio: scenario.defaults.portfolio,
          monthlyContribution: scenario.isEdited.annualContribution
            ? scenario.engine.monthlyContribution
            : null,
          monthlyExpenses: scenario.isEdited.monthlyExpenses
            ? scenario.values.monthlyExpenses
            : null,
          swr: scenario.isEdited.swrPct ? scenario.engine.swr : null,
          inflation: scenario.isEdited.inflationPct ? scenario.engine.inflation : null,
          salaryByPersonIndex: realPersons
            .slice(0, 2)
            .map((p) =>
              p.id != null && scenario.salaryByPersonId[p.id] != null
                ? scenario.salaryByPersonId[p.id]
                : null,
            ),
        },
        todayIso,
      );
      const existing = useScenariosStore.getState().scenarios;
      await useScenariosStore.getState().create({
        name: `From calculators — ${formatDate(todayIso)}`,
        isBaseline: false,
        color: defaultScenarioColor(existing.length, false),
        lineStyle: 'solid',
        visible: true,
        isActive: false,
        sortOrder: existing.length,
        leverPayload,
      });
      setSendError(null);
      navigate('/what-if');
    } catch {
      // Calm inline surface — never throw to the route.
      setSendError('Could not create the What-If scenario. Please try again.');
    }
  };

  const chips: string[] = household
    ? [
        FILING_LABELS[household.filingStatus] ?? household.filingStatus,
        household.state,
        ...(household.city ? [prettifyCityCode(household.city)] : []),
        ...(tax.resolvedYear != null ? [`${tax.resolvedYear} tax year`] : []),
        ...(tax.totalSalary > 0 ? [`${formatCurrency(tax.totalSalary)} salary`] : []),
      ]
    : [];

  return (
    <section
      role="region"
      aria-label="Your scenario"
      data-testid="scenario-bar"
      className="rounded-md border bg-card p-4 space-y-3 min-w-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 min-w-0">
          <span className="text-sm font-medium">Your scenario</span>
          <span className="text-xs text-muted-foreground" data-testid="scenario-chips">
            {household ? chips.join(' · ') : 'No household set up yet'}
          </span>
          <InlineLink to="/inputs" className="text-xs">
            Edit in Inputs
          </InlineLink>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {scenario.editedCount > 0 && (
            <>
              <span
                className="inline-flex items-center gap-1 text-muted-foreground"
                data-testid="scenario-edited-count"
              >
                <BlazeDot />
                Edited ({scenario.editedCount})
              </span>
              <button
                type="button"
                onClick={() => {
                  scenario.resetAll();
                  // W16 review: this button unmounts once editedCount hits 0 —
                  // hand focus to the first scenario field, not <body>.
                  document.getElementById(FIELDS[0].id)?.focus();
                }}
                className="text-primary hover:underline"
              >
                Reset to my data
              </button>
            </>
          )}
          {/* D14: enabled only when ≥1 bar field is edited. */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={scenario.editedCount === 0}
            onClick={() => void sendToWhatIf()}
          >
            Send to What-If →
          </Button>
        </div>
      </div>
      {sendError && (
        <div role="alert" className="text-xs text-destructive-soft-foreground">
          {sendError}
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {FIELDS.map((spec) => (
          <ScenarioBarField
            key={spec.field}
            spec={spec}
            committed={scenario.values[spec.field]}
            edited={scenario.isEdited[spec.field]}
            provenance={scenario.provenance[spec.field]}
            onCommit={scenario.setField}
            onReset={scenario.resetField}
          />
        ))}
        {/* D14: per-person editable salary — one row per earner (named at 2+). */}
        {realPersons.slice(0, 2).map((p) =>
          p.id != null ? (
            <SalaryBarField
              key={`salary-${p.id}`}
              id={`scenario-salary-${p.id}`}
              label={realPersons.length > 1 ? `${p.name}'s salary` : 'Salary'}
              committed={scenario.salaryByPersonId[p.id] ?? p.annualSalaryPretax}
              edited={scenario.salaryByPersonId[p.id] != null}
              onCommit={(v) => scenario.setSalary(p.id!, v)}
              onReset={() => scenario.setSalary(p.id!, null)}
            />
          ) : null,
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Edits here are a temporary scenario. Nothing is saved to your data.
      </p>
    </section>
  );
}
