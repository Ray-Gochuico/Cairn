import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NumberField } from '@/components/calculators/NumberField';
import { Button } from '@/components/ui/button';
import { useScenarioAssumptions } from '@/lib/calculators/use-scenario-assumptions';
import { readOverridesFor, type ScenarioField } from '@/lib/calculators/scenario-assumptions';
import { useHouseholdTaxContext } from '@/lib/calculators/use-household-tax-context';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useScenariosStore } from '@/stores/scenarios-store';
import { leverPayloadFromScenarioBar } from '@/lib/whatif/from-scenario-bar';
import { defaultScenarioColor } from '@/lib/whatif/scenario-colors';
import { localTodayISO } from '@/lib/dates';
import { formatCurrency, formatDate } from '@/lib/format';
import { FILING_STATUS_LABELS } from '@/lib/filing-status-labels';
import { prettifyCityCode } from '@/lib/jurisdiction-format';
import { InlineLink } from '@/components/calculators/InlineLink';
import { useViewFilter } from '@/lib/use-view-filter';
import { useCalcScope } from '@/lib/calculators/use-calc-scope';
import { EarnerSelect } from '@/components/calculators/EarnerSelect';
import { DollarBasisToggle } from '@/components/calculators/DollarBasisToggle';
import { useTransactionsStore } from '@/stores/transactions-store';
import { personMonthlyExpenseHint } from '@/lib/calculators/person-expense-hint';

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
  /** Wave B (CB5): optional muted hint line under the provenance row. */
  hint?: string;
  onCommit: (field: ScenarioField, value: number) => void;
  onReset: (field: ScenarioField) => void;
}) {
  const { spec, committed, edited, provenance, hint, onCommit, onReset } = props;
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
        /* Wave C (C10/DC2): provenance is the honesty layer — clamp to two
           lines instead of truncating ("joint accounts not included" was
           unreadable at grid widths). The bar has no height cap, so the
           second line is free. */
        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2" title={provenance}>
          {provenance}
        </p>
      )}
      {hint && (
        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2" title={hint}>
          {hint}
        </p>
      )}
    </div>
  );
}

/** Wave B (CB1): the page-scope control — bound to the SAME ?view= URL state
 *  as the app-wide ViewFilter (whose header copy is hidden on /calculators,
 *  D-B12). Scope is a lens: this never touches overrides or editedCount. */
function ScopeControl() {
  const { filter, setFilter, isAvailable, persons } = useViewFilter();
  if (!isAvailable) return null;
  const selectedId =
    filter === 'p1' ? (persons[0]?.id ?? null)
    : filter === 'p2' ? (persons[1]?.id ?? null)
    : null; // household + joint both render Household (D-B2)
  return (
    <EarnerSelect
      persons={persons}
      selectedId={selectedId}
      onChange={(id) => {
        if (id == null) setFilter('household');
        else if (id === persons[0]?.id) setFilter('p1');
        else setFilter('p2');
      }}
      label="Calculator scope"
      includeCombined
      combinedLabel="Household"
    />
  );
}

export function ScenarioBar() {
  const household = useHouseholdStore((s) => s.household);
  const tax = useHouseholdTaxContext();
  const scenario = useScenarioAssumptions();
  const navigate = useNavigate();
  // The REAL persons (prefills + reset targets); tax.persons are effective.
  const realPersons = usePersonsStore((s) => s.persons);
  const scope = useCalcScope();
  const transactions = useTransactionsStore((s) => s.transactions);
  const [sendError, setSendError] = useState<string | null>(null);

  // CB5 (D-B5): the transactions-derived per-person expense hint — one muted
  // line under Monthly expenses in person scope, never a default.
  const expenseHint = useMemo(() => {
    if (!scope.isScoped || scope.personId == null) return undefined;
    const avg = personMonthlyExpenseHint(transactions, scope.personId, localTodayISO());
    return avg != null
      ? `${scope.personName}'s attributed transactions suggest ~${formatCurrency(avg)}/mo`
      : undefined;
  }, [scope, transactions]);

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
      // Wave C review (MAJOR 2): after an app restart the store is [] until
      // something loads it — reading it cold made DC6 activate a SECOND
      // scenario, and the single-active UNIQUE constraint then failed every
      // retry. Load first (in-flight-deduped; cheap when already warm).
      await useScenariosStore.getState().load();
      const existing = useScenariosStore.getState().scenarios;
      // Wave C (DC6) + smoke investigation (2026-08-07): there is no
      // standalone ensureBaseline helper — the Baseline seed lives INSIDE
      // useScenariosStore.load() (first load of an EMPTY table creates the
      // Baseline with isActive: true), and the awaited load above runs it.
      // So on a fresh profile the vacuum below can no longer occur on this
      // path: sends arrive with the Baseline active and create
      // isActive: false (highlighted on arrival, never stealing activation).
      // The branch is kept belt-and-braces for the residual all-inactive
      // state — scenariosStore.remove() deletes without reassigning
      // activation, so deleting the active scenario leaves a POPULATED
      // table with no isActive row (the seed only fires on an empty one) —
      // and its test pins the vacuum by stubbing load. Do NOT remove it or
      // change activation semantics; whether a sent scenario should steal
      // activation is an open owner design question.
      const hasActive = existing.some((s) => s.isActive);
      const createdId = await useScenariosStore.getState().create({
        name: `From calculators — ${formatDate(todayIso)}`,
        isBaseline: false,
        color: defaultScenarioColor(existing.length, false),
        lineStyle: 'solid',
        visible: true,
        isActive: !hasActive,
        sortOrder: existing.length,
        leverPayload,
      });
      setSendError(null);
      navigate('/what-if', { state: { createdScenarioId: createdId } });
    } catch {
      // Calm inline surface — never throw to the route.
      setSendError('Could not create the What-If scenario. Please try again.');
    }
  };

  const chips: string[] = household
    ? [
        FILING_STATUS_LABELS[household.filingStatus] ?? household.filingStatus,
        household.state,
        ...(household.city ? [prettifyCityCode(household.city)] : []),
        ...(tax.resolvedYear != null ? [`${tax.resolvedYear} tax year`] : []),
        // Wave C (N2/CW19): the chips stay household-level by design (D-B2
        // family) — while scoped, qualify the salary so it can't be misread
        // as the person's own figure.
        ...(tax.totalSalary > 0
          ? [`${formatCurrency(tax.totalSalary)}${scope.isScoped ? ' household salary' : ' salary'}`]
          : []),
      ]
    : [];

  // Wave C review (MINOR 5): the Return field has NO What-If lever
  // counterpart, so a Return-only edit maps to an empty payload — which DC6
  // would now auto-activate as a scenario that does nothing. Send requires
  // at least one edit the D6 mapping actually carries (mirrors
  // leverPayloadFromScenarioBar's branches, incl. the portfolio===real
  // no-op guard).
  const hasMappableEdit =
    (scenario.isEdited.portfolio &&
      scenario.values.portfolio !== scenario.defaults.portfolio) ||
    scenario.isEdited.annualContribution ||
    scenario.isEdited.monthlyExpenses ||
    scenario.isEdited.swrPct ||
    scenario.isEdited.inflationPct ||
    Object.keys(scenario.salaryByPersonId).length > 0;

  // Wave C (N2): flipping Household → person silently shrank "Edited (4)" to
  // "Edited (1)" — household edits looked destroyed (they're preserved in
  // their silo, D-B11). Declare the view on the badge and count the kept edits.
  const keptHouseholdEdits = scope.isScoped
    ? Object.keys(readOverridesFor(null)).length +
      Object.keys(scenario.salaryByPersonId).filter((id) => Number(id) !== scope.personId).length
    : 0;

  return (
    <section
      role="region"
      aria-label="Your scenario"
      data-testid="scenario-bar"
      className="rounded-md border bg-card p-4 space-y-2 min-w-0"
    >
      <div className="space-y-1">
        {/* Row 1 — identity: title · chips · Edit in Inputs · scope control */}
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 min-w-0">
          <span className="text-sm font-medium">Your scenario</span>
          <span className="text-xs text-muted-foreground" data-testid="scenario-chips">
            {household
              ? realPersons.length === 0
                ? `${chips.join(' · ')} — app defaults` // DC9: nothing user-confirmed yet
                : chips.join(' · ')
              : 'No household set up yet'}
          </span>
          <InlineLink to="/inputs" className="text-xs">
            Edit in Inputs
          </InlineLink>
          <ScopeControl />
          <div className="ml-auto">
            <DollarBasisToggle />
          </div>
        </div>
        {/* Row 2 — actions (A#3: never a lone orphaned cluster under the title).
            Left: the nothing-saved contract (CW16, moved verbatim from the old
            footer line — with the tighter gaps below this reclaims ~70px of
            the 1024 first screen) OR the Edited badge + Reset. Right: reason
            note + Send, ml-auto so the notes never rewrap the row. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <div className="flex min-w-0 items-center gap-3 text-xs">
            {scenario.editedCount > 0 ? (
              <>
                <span
                  className="inline-flex items-center gap-1 text-muted-foreground"
                  data-testid="scenario-edited-count"
                  title={
                    scope.isScoped
                      ? `${keptHouseholdEdits} household-scope edit${keptHouseholdEdits === 1 ? '' : 's'} kept`
                      : undefined
                  }
                >
                  <BlazeDot />
                  Edited ({scenario.editedCount}){scope.isScoped ? ' in this view' : ''}
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
            ) : (
              <span className="text-muted-foreground">
                Edits here are a temporary scenario. Nothing is saved to your data.
              </span>
            )}
          </div>
          <div className="ml-auto flex items-center gap-3 text-xs">
            {/* D-B6: a person-scoped payload would silently misattribute —
                disabled in person scope with the one-line reason. */}
            {scope.isScoped && (
              <span
                id="send-whatif-scoped-note"
                className="text-muted-foreground"
                data-testid="send-whatif-scoped-note"
              >
                Switch to Household to send this scenario.
              </span>
            )}
            {/* Wave C (C11/CW15): the 0-edits disabled Send previously gave no
                reason at all — the visible note doubles as the button's
                accessible description. */}
            {!scope.isScoped && scenario.editedCount === 0 && (
              <span id="send-whatif-empty-note" className="text-muted-foreground">
                Edit a field above to send it as a scenario.
              </span>
            )}
            {/* Wave C review (MINOR 5): edits exist but none maps to a lever
                (e.g. Return-only) — say why Send stays disabled. */}
            {!scope.isScoped && scenario.editedCount > 0 && !hasMappableEdit && (
              <span id="send-whatif-unmappable-note" className="text-muted-foreground">
                This edit doesn’t map to a What-If lever yet.
              </span>
            )}
            {/* D14: enabled only when ≥1 MAPPABLE bar field is edited. Wave B
                gate fix: the reason is programmatically associated so AT users
                hear WHY the button is disabled, not just a bare control. */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={scenario.editedCount === 0 || scope.isScoped || !hasMappableEdit}
              aria-describedby={
                scope.isScoped
                  ? 'send-whatif-scoped-note'
                  : scenario.editedCount === 0
                    ? 'send-whatif-empty-note'
                    : !hasMappableEdit
                      ? 'send-whatif-unmappable-note'
                      : undefined
              }
              onClick={() => void sendToWhatIf()}
            >
              Send to What-If →
            </Button>
          </div>
        </div>
      </div>
      {sendError && (
        <div role="alert" className="text-xs text-destructive-soft-foreground">
          {sendError}
        </div>
      )}
      {/* Wave C smoke fix (2026-08-07): xl capped at FOUR columns — six packed
          ~174px fields inside the max-w-6xl container, and the longest
          provenance contract string ("…— joint accounts not included")
          ellipsized INSIDE the DC2 two-line clamp at 1440×900 (manual check:
          scrollHeight > clientHeight on the provenance <p>). Four columns
          (~267px) hold it with room; below xl — the Task-10 1024 layout —
          nothing changes. */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-x-3 gap-y-2">
        {FIELDS.map((spec) => (
          <ScenarioBarField
            key={spec.field}
            spec={spec}
            committed={scenario.values[spec.field]}
            edited={scenario.isEdited[spec.field]}
            provenance={scenario.provenance[spec.field]}
            hint={spec.field === 'monthlyExpenses' ? expenseHint : undefined}
            onCommit={scenario.setField}
            onReset={scenario.resetField}
          />
        ))}
        {/* D14: per-person editable salary — one row per earner (named at 2+).
            Wave B (D-B11): in person scope only the scoped person's row renders. */}
        {realPersons
          .slice(0, 2)
          .filter((p) => scope.personId == null || p.id === scope.personId)
          .map((p) =>
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
    </section>
  );
}
