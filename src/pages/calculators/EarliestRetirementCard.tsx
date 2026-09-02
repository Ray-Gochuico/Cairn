import { CalculatorCard, EmptyMeaning } from './CalculatorCard';
import { InlineLink } from '@/components/calculators/InlineLink';
import { ScopeExclusionsLine } from '@/components/calculators/ScopeExclusionsLine';
import { useScenarioAssumptions } from '@/lib/calculators/use-scenario-assumptions';
import { useCalcScope } from '@/lib/calculators/use-calc-scope';
import { realRateOfUnfloored } from '@/lib/calculators/real-rate';
import { yearsToFi } from '@/lib/financial-independence';
import { MAX_SOLVE_AGE, solveEarliestRetirement } from '@/lib/calculators/retirement-age-solver';
import { pickModerateEntry } from '@/lib/growth-scenario';
import { currentAge } from '@/lib/dates';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { formatCurrency, formatPercent } from '@/lib/format';

const TITLE = 'Earliest Retirement';

/**
 * Whole years from the closed form, snapped first. `log(ratio)/log(base)`
 * returns t + ~1e-14 at an EXACT integer solution, so a bare `ceil` answered
 * t + 1 while the bisection (FV(t) ≥ target) answered t — the headline could
 * then sit outside its own across-scenarios range ('Age 42' under '43–43').
 * The tolerance is the solver suite's own knife-edge epsilon (review MINOR 4).
 */
const CEIL_EPS = 1e-9;
const wholeYears = (years: number): number =>
  Math.ceil(Math.abs(years - Math.round(years)) < CEIL_EPS ? Math.round(years) : years);

/**
 * W1 — the Earliest Retirement card (D-R1..R6): inverts the PathToFi
 * criterion over whole years and keeps the search VISIBLE — every probe of
 * the integer bisection renders in tested order, the verdict last. Railless
 * (DP-8: zero card-local numbers — everything rides the shared scenario bar
 * and persons data); `dirty` follows shared-scenario edits only. One-place-
 * per-thing at the math layer: the closed-form `yearsToFi` is the solver's
 * oracle, so this card and Path to FI can never disagree (D-R4).
 */
export function EarliestRetirementCard({ cardId = 'retirement-age' }: { cardId?: string }) {
  const { engine, scenarioList, editedCount, scopeExclusions, provenance } = useScenarioAssumptions();
  const scope = useCalcScope();
  const household = useHouseholdStore((s) => s.household);
  const persons = usePersonsStore((s) => s.persons);

  // Whose age (D-R5/DP-11): person scope → that person; household → all
  // persons. A two-person solve is household money with an age-denominated
  // LABEL only — the headline speaks in years-from-now and the search caps
  // where the OLDER person reaches 90 (the schema cap binds there first).
  const subjects = scope.isScoped && scope.person ? [scope.person] : persons;
  const twoPerson = !scope.isScoped && subjects.length === 2;
  const ages = subjects.map((p) => currentAge(p.dateOfBirth));
  const ageNow = subjects.length === 0 ? null : twoPerson ? Math.max(...ages) : ages[0];
  const subjectName = twoPerson ? null : (subjects[0]?.name ?? null);

  const targetFv = engine.swr > 0 ? engine.annualExpenses / engine.swr : 0;
  const noTarget = targetFv <= 0 || engine.monthlyExpenses <= 0; // PathToFi's predicate
  const moderate = pickModerateEntry(scenarioList);
  const realRate = moderate ? realRateOfUnfloored(moderate.rate, engine.inflation) : 0;

  const solve =
    ageNow == null || noTarget || moderate == null
      ? null
      : solveEarliestRetirement({
          ageNow,
          pv: engine.portfolio,
          pmt: engine.annualContribution,
          realRate,
          targetFv,
          maxAge: MAX_SOLVE_AGE,
        });

  // DP-12: closed-form earliest per scenario for the range sub-line — the
  // exact gates of PathToFi's range line (finite, within the cap, >1 left).
  const scenarioTs =
    ageNow == null || noTarget
      ? []
      : scenarioList
          .map((s) =>
            yearsToFi({
              pv: engine.portfolio,
              pmt: engine.annualContribution,
              annualRate: realRateOfUnfloored(s.rate, engine.inflation),
              targetFv,
            }),
          )
          .filter((y) => Number.isFinite(y))
          .map(wholeYears)
          .filter((t) => ageNow + t <= MAX_SOLVE_AGE);

  const dirty = editedCount > 0; // DP-8: no card-local overrides exist

  // ── hasData empties (CP-42; PathToFi's predicates and order) ──
  if (!household) {
    return (
      <CalculatorCard
        cardId={cardId}
        title={TITLE}
        headline={<span>—</span>}
        meaning={
          <EmptyMeaning>
            <InlineLink to="/inputs/household">Set up your household</InlineLink> to see your
            earliest retirement age.
          </EmptyMeaning>
        }
      />
    );
  }
  if (persons.length === 0) {
    return (
      <CalculatorCard
        cardId={cardId}
        title={TITLE}
        headline={<span>—</span>}
        meaning={
          <EmptyMeaning>
            <InlineLink to="/inputs/persons">Add a person</InlineLink> to see your earliest
            retirement age.
          </EmptyMeaning>
        }
      />
    );
  }
  if (scenarioList.length === 0) {
    return (
      <CalculatorCard
        cardId={cardId}
        title={TITLE}
        headline={<span>—</span>}
        meaning={
          <EmptyMeaning>
            Your household has no growth scenarios —{' '}
            <InlineLink to="/inputs/household">add growth scenarios in Household settings</InlineLink>{' '}
            to see your earliest retirement age.
          </EmptyMeaning>
        }
      />
    );
  }
  // ── noTarget (CP-41; PathToFi's register, tail adapted) ──
  if (noTarget) {
    return (
      <CalculatorCard
        cardId={cardId}
        title={TITLE}
        dirty={dirty}
        headline={<span>—</span>}
        meaning={
          <>
            Enter monthly expenses and a withdrawal rate in the scenario bar above to see your
            earliest retirement age.
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          Adjust shared assumptions in the scenario bar above.
        </p>
      </CalculatorCard>
    );
  }
  if (solve == null || ageNow == null || moderate == null) return null; // unreachable after the gates above

  const answerT = solve.answerT ?? 0;
  const rowLead = (t: number) => (twoPerson ? `In ${t} years` : `Age ${ageNow + t}`);
  const rangeLine =
    solve.verdict === 'age-found' && scenarioTs.length > 1
      ? twoPerson
        ? `${Math.min(...scenarioTs)}–${Math.max(...scenarioTs)} years across scenarios`
        : `${ageNow + Math.min(...scenarioTs)}–${ageNow + Math.max(...scenarioTs)} across scenarios`
      : null;

  const headline =
    solve.verdict === 'already-holds' ? (
      <span>Now</span>
    ) : solve.verdict === 'age-found' ? (
      <span>
        {twoPerson ? `In ${answerT} years` : `Age ${ageNow + answerT}`}
        {rangeLine && (
          <span className="block text-xs font-normal text-muted-foreground">{rangeLine}</span>
        )}
      </span>
    ) : (
      <span>—</span>
    );

  const meaning =
    solve.verdict === 'already-holds' ? (
      <>
        {twoPerson
          ? 'the target is already met today — nothing left to solve.'
          : `the target is already met at age ${ageNow} — nothing left to solve.`}
      </>
    ) : solve.verdict === 'not-by-max' ? (
      <>the plan doesn&#39;t hold by age 90 under these assumptions.</>
    ) : solve.verdict === 'never-real' ? (
      // Wave 17 honesty lock (verbatim): the warning REPLACES the sentence.
      <span className="text-warning-foreground">
        Returns at or below inflation — the target is never reached in real terms.
      </span>
    ) : solve.verdict === 'past-max' ? (
      <>Past age 90 — the solver&#39;s search range ends there.</>
    ) : twoPerson ? (
      <>
        {`earliest year the household plan holds — when ${subjects[0].name} is ${ages[0] + answerT} and ${subjects[1].name} is ${ages[1] + answerT}, at your ${moderate.label} scenario`}
      </>
    ) : (
      <>{`earliest whole-year age where ${subjectName}'s plan holds — at your ${moderate.label} scenario`}</>
    );

  const criterion = `Holds means: the projected portfolio at that age meets the target ${formatCurrency(targetFv)} = 12 × ${formatCurrency(engine.monthlyExpenses)}/mo ÷ ${formatPercent(engine.swr)} SWR — in today's dollars, at ${formatPercent(moderate.rate)} ≈ ${formatPercent(realRate)} real.`;
  const contributionsLine = `Contributions of ${formatCurrency(engine.annualContribution)}/yr continue until ${twoPerson ? 'then' : 'that age'} — ${provenance.annualContribution}.`;

  return (
    <CalculatorCard cardId={cardId} title={TITLE} dirty={dirty} headline={headline} meaning={meaning}>
      <p className="text-sm text-muted-foreground">{criterion}</p>
      {solve.probes.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">The search</div>
          <ol className="mt-1 space-y-1 text-sm" data-testid="retirement-age-probes">
            {solve.probes.map((p) => (
              <li key={p.t} className="flex items-center gap-1.5 tabular-nums">
                <span aria-hidden="true">{p.holds ? '✓' : '✕'}</span>
                <span className="sr-only">{p.holds ? 'Holds: ' : 'Not yet: '}</span>
                <span>
                  {`${rowLead(p.t)} · ${formatCurrency(p.fv)} vs ${formatCurrency(targetFv)} — ${p.holds ? 'holds' : 'not yet'}`}
                </span>
              </li>
            ))}
          </ol>
          {solve.verdict === 'age-found' && (
            <p className="mt-1 text-sm font-medium" data-testid="retirement-age-verdict">
              {twoPerson
                ? `Earliest: in ${answerT} years — the first year that holds.`
                : `Earliest: age ${ageNow + answerT} — the first age that holds.`}
            </p>
          )}
        </div>
      )}
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>{contributionsLine}</p>
        <p>Ages count whole years from today.</p>
      </div>
      {scope.isScoped && scopeExclusions && (
        <ScopeExclusionsLine
          personName={scope.personName!}
          noun="solve"
          jointPortfolio={scopeExclusions.jointPortfolio}
          unattributedContribution={scopeExclusions.unattributedContribution}
          testId="retirement-age-scope-exclusions"
        />
      )}
    </CalculatorCard>
  );
}
