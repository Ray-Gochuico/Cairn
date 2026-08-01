import { useMemo } from 'react';
import { useEquityGrantsStore } from '@/stores/equity-grants-store';
import { usePersonsStore } from '@/stores/persons-store';
import { CalculatorCard, EmptyMeaning, RailReset } from './CalculatorCard';
import {
  computeEquityValue,
  forwardVestChartData,
  isIsoAmtPreference,
  vestsInWindow,
} from '@/lib/equity-value';
import { formatCurrency, formatDate } from '@/lib/format';
import { useLocalToday } from '@/lib/use-local-today';
import { useCalculatorState } from '@/lib/calculator-state';
import { FreshnessBadge } from '@/components/ui/freshness-badge';
import { NumberField } from '@/components/calculators/NumberField';
import { NotModeledDisclosure } from '@/components/calculators/NotModeledDisclosure';
import { ResultRow } from '@/components/calculators/ResultRow';
import { CalcTable, CalcRow, type CalcColumn } from '@/components/calculators/CalcTable';
import { InlineChart } from '@/components/charts/InlineChart';
import { TermTooltip } from '@/components/ui/glossary-tooltip';
import type { GrantType } from '@/types/enums';
import { InlineLink } from '@/components/calculators/InlineLink';
import { useCalcScope } from '@/lib/calculators/use-calc-scope';
import { partitionHidden } from '@/lib/view-scope';
import { ScopeCaption } from '@/components/layout/ScopeCaption';
import { FilteredEmptyState } from '@/components/layout/FilteredEmptyState';

interface EquityValueCardProps {
  cardId?: string;
}

interface PersonTotal {
  ownerPersonId: number;
  name: string;
  vested: number;
  grantCount: number;
  grantTypes: GrantType[];
}

const OWNER_COLUMNS: CalcColumn[] = [
  { key: 'owner', header: 'Owner' },
  { key: 'grants', header: 'Grants', numeric: true },
  { key: 'vested', header: 'Vested value', numeric: true },
];

/**
 * Wave 18 C11 — Equity value as a real calculator: an FMV what-if in the
 * rail (D8: single-company households only — one override repricing
 * unrelated companies would be dishonest), the next-12-months planning
 * figure (D10 forward window), dollar-annotated upcoming vests, a forward
 * vest chart, and ONE NotModeledDisclosure. src/lib/equity-value.ts
 * functions stay pure — repricing maps grants at the card boundary.
 */
export function EquityValueCard({ cardId }: EquityValueCardProps = {}) {
  const equityGrants = useEquityGrantsStore((s) => s.equityGrants);
  const persons = usePersonsStore((s) => s.persons);

  // Live LOCAL day (Wave 11 T9): re-derives at the midnight flip via
  // useLocalToday.
  const todayISO = useLocalToday();

  const scope = useCalcScope();
  // Wave B: the ONE exact split — grants are non-nullably owned. Filter first;
  // every derived figure below (single-company gate, FMV prefill, totals,
  // forward window) then re-scopes for free.
  const scopedGrants = useMemo(
    () =>
      scope.personId == null
        ? equityGrants
        : equityGrants.filter((g) => g.ownerPersonId === scope.personId),
    [equityGrants, scope.personId],
  );
  const grantPartition = useMemo(
    () => partitionHidden(equityGrants, scopedGrants, (g) => g.ownerPersonId),
    [equityGrants, scopedGrants],
  );

  // D8: the rail FMV field renders only when ALL grants share one company.
  const singleCompany = useMemo(
    () => new Set(scopedGrants.map((g) => g.companyName)).size === 1,
    [scopedGrants],
  );

  // Stored FMV prefill: all one company; if grants disagree, use the
  // max-share-count grant's FMV (the dominant position names the company's
  // price; any disagreement is stale data the what-if lets the user reprice).
  const { storedFmv, storedUpdatedAt } = useMemo(() => {
    if (scopedGrants.length === 0) return { storedFmv: 0, storedUpdatedAt: undefined };
    const dominant = [...scopedGrants].sort((a, b) => b.totalShares - a.totalShares)[0];
    return { storedFmv: dominant.currentFmv, storedUpdatedAt: dominant.updatedAt };
  }, [scopedGrants]);

  // Wave B gate fix (MAJOR): the single company the CURRENT scope's gate saw.
  // The stored override is tagged with its originating company and applies
  // only when it matches — the calc-state:equity silo is scope-global (D-B9:
  // value overrides survive scope flips), and the per-scope D8 gate would
  // otherwise let an override typed in one person's scope (company X)
  // reprice the other person's company-Y grants.
  const dominantCompany = singleCompany ? (scopedGrants[0]?.companyName ?? null) : null;

  const defaults = useMemo(
    () => ({ fmvPerShare: storedFmv, fmvCompany: dominantCompany ?? '' }),
    [storedFmv, dominantCompany],
  );
  const { values, setValue, reset, overriddenKeys } = useCalculatorState(
    cardId ?? 'equity',
    defaults,
  );
  // Applied = overridden AND the stored company tag matches this scope's
  // single company (W18 D8 restored: an override never reprices a different
  // company's grants). A mismatched stored override renders as not-applied.
  const fmvOverridden =
    singleCompany &&
    overriddenKeys.has('fmvPerShare') &&
    overriddenKeys.has('fmvCompany') &&
    values.fmvCompany === dominantCompany;

  // All figures derive from pricedGrants — vested/unvested/income reprice live.
  const pricedGrants = useMemo(
    () =>
      fmvOverridden
        ? scopedGrants.map((g) => ({ ...g, currentFmv: values.fmvPerShare ?? g.currentFmv }))
        : scopedGrants,
    [fmvOverridden, scopedGrants, values.fmvPerShare],
  );

  // Owner name lookup (id is non-nullable on persisted Person rows).
  const personById = useMemo(
    () => new Map(persons.map((p) => [p.id!, p.name])),
    [persons],
  );

  // Group grants by ownerPersonId, summing vestedValue per person. Stable
  // ordering: insertion order (grant load order).
  const { perPerson, totalUnvested } = useMemo(() => {
    const map = new Map<number, PersonTotal>();
    let totalUnvestedAcc = 0;
    for (const g of pricedGrants) {
      const result = computeEquityValue(g, todayISO);
      totalUnvestedAcc += result.unvestedValue;
      const personName = personById.get(g.ownerPersonId) ?? 'Unknown';
      const prev = map.get(g.ownerPersonId);
      const grantType = g.grantType;
      if (prev) {
        prev.vested += result.vestedValue;
        prev.grantCount += 1;
        if (!prev.grantTypes.includes(grantType)) {
          prev.grantTypes.push(grantType);
        }
      } else {
        map.set(g.ownerPersonId, {
          ownerPersonId: g.ownerPersonId,
          name: personName,
          vested: result.vestedValue,
          grantCount: 1,
          grantTypes: [grantType],
        });
      }
    }
    return { perPerson: [...map.values()], totalUnvested: totalUnvestedAcc };
  }, [pricedGrants, personById, todayISO]);

  const totalVested = useMemo(
    () => perPerson.reduce((sum, p) => sum + p.vested, 0),
    [perPerson],
  );

  // D10: the forward window is the planning figure — next 12 months headline
  // row, next 3 events with dollars (24-month fallback when 12 is empty),
  // 24-month cumulative chart.
  const next12 = useMemo(() => vestsInWindow(pricedGrants, todayISO, 12), [pricedGrants, todayISO]);
  const next24Events = useMemo(
    () => (next12.events.length > 0 ? next12.events : vestsInWindow(pricedGrants, todayISO, 24).events),
    [next12.events, pricedGrants, todayISO],
  );
  const forwardChart = useMemo(
    () => forwardVestChartData(pricedGrants, todayISO, 24),
    [pricedGrants, todayISO],
  );
  const hasForwardVests = useMemo(
    () => forwardChart.some((p) => p.cumulativeValue > 0),
    [forwardChart],
  );

  const hasIso = useMemo(
    () => scopedGrants.some((g) => isIsoAmtPreference(g.grantType)),
    [scopedGrants],
  );

  if (equityGrants.length === 0) {
    return (
      <CalculatorCard
        cardId={cardId}
        title="Equity Value"
        headline="—"
        meaning={
          // W14b moved equity grants out of Inputs — /inputs/equity-grants is
          // only a redirect stub now; link the canonical home directly.
          <EmptyMeaning>
            <InlineLink to="/equity-grants">
              Add equity grants
            </InlineLink>{' '}
            to see vested value across your household.
          </EmptyMeaning>
        }
      />
    );
  }

  // Wave B tier-2 (D-B1): the household HAS grants, the scoped person owns
  // none — counted declaration + View household, never onboarding copy.
  if (scope.isScoped && scopedGrants.length === 0) {
    return (
      <CalculatorCard
        cardId={cardId}
        title="Equity Value"
        headline="—"
        meaning={<>No grants in {scope.personName}&#39;s name.</>}
      >
        <FilteredEmptyState noun="grants" partition={grantPartition} bare />
      </CalculatorCard>
    );
  }

  const rail = (
    <>
      {fmvOverridden && <RailReset onClick={reset} />}
      {singleCompany ? (
        <div className="space-y-1">
          <NumberField
            id="equity-fmv"
            label="FMV per share (what-if)"
            // A stored override from ANOTHER company renders as not-applied:
            // the field shows this scope's default, no edited dot.
            value={fmvOverridden ? values.fmvPerShare : storedFmv}
            onChange={(v) => {
              setValue('fmvPerShare', v ?? 0);
              // Tag the override with the company it was typed against.
              setValue('fmvCompany', dominantCompany ?? '');
            }}
            suffix="$"
            step="0.5"
            min={0}
            edited={fmvOverridden}
          />
          <p className="text-xs text-muted-foreground">
            prefilled from your stored FMV
            {storedUpdatedAt ? ` (updated ${formatDate(storedUpdatedAt.slice(0, 10))})` : ''}
          </p>
        </div>
      ) : (
        // D8: a single override across companies would reprice unrelated
        // grants — dishonest. Quiet note instead of the field.
        <p className="text-xs text-muted-foreground">
          Grants span multiple companies — edit each grant&#39;s FMV in Inputs.
        </p>
      )}
    </>
  );

  return (
    <CalculatorCard
      cardId={cardId}
      title="Equity Value"
      dirty={fmvOverridden}
      meaning={
        scope.isScoped ? (
          <>
            vested for {scope.personName} · {formatCurrency(next12.totalValue)} vesting in the
            next 12 months
          </>
        ) : (
          <>
            vested today · {formatCurrency(next12.totalValue)} vesting in the next 12 months
          </>
        )
      }
      rail={rail}
      headline={
        <span data-testid="equity-value-headline">
          {formatCurrency(totalVested)}
        </span>
      }
    >
      {scope.isScoped && (
        <>
          <ScopeCaption noun="grants" partition={grantPartition} />
          <p className="text-xs text-muted-foreground">
            Grants are individually owned — {scope.personName}&#39;s figure is exact; nothing
            joint exists to exclude.
          </p>
        </>
      )}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <p className="text-sm text-muted-foreground">
          Total vested across {scopedGrants.length}{' '}
          {scopedGrants.length === 1 ? 'grant' : 'grants'}.
        </p>
        <FreshnessBadge size="sm" />
      </div>
      <ResultRow
        label="Total vested"
        emphasis
        testId="equity-total-vested"
        value={formatCurrency(totalVested)}
      />
      <ResultRow
        label="Total unvested"
        testId="equity-total-unvested"
        value={formatCurrency(totalUnvested)}
      />
      {/* Planning-figure swap (C11): the forward window replaces the old
          "if unvested vests today" framing. */}
      <ResultRow
        label="Vesting in the next 12 months"
        emphasis
        testId="equity-next-12mo"
        value={formatCurrency(next12.totalValue)}
      />
      <ResultRow
        label="Est. ordinary income from those vests"
        testId="equity-ordinary-income"
        value={formatCurrency(next12.totalOrdinaryIncome)}
      />
      <p className="text-xs text-muted-foreground mt-1">
        Estimated ordinary income at vest — not withheld tax.
      </p>
      {next24Events.length > 0 && (
        <div
          data-testid="equity-upcoming-vests"
          className="text-xs text-muted-foreground mt-1"
        >
          Next vests:{' '}
          {next24Events
            .slice(0, 3)
            .map((e) => `${formatDate(e.date)} · ${formatCurrency(e.value)}`)
            .join(', ')}
        </div>
      )}
      <CalcTable columns={OWNER_COLUMNS} testId="equity-owner-table">
        {perPerson.map((p) => (
          <CalcRow
            key={p.ownerPersonId}
            columns={OWNER_COLUMNS}
            testId={`equity-person-row-${p.ownerPersonId}`}
            cells={[
              <>
                {p.name}
                {p.grantTypes.map((type) =>
                  type === 'ISO' || type === 'NSO' ? (
                    <TermTooltip key={type} term={type}>
                      <span className="ml-1 inline-block rounded bg-muted px-1.5 py-0.5 text-xs">
                        {type}
                      </span>
                    </TermTooltip>
                  ) : (
                    <span
                      key={type}
                      className="ml-1 inline-block rounded bg-muted px-1.5 py-0.5 text-xs"
                    >
                      {type}
                    </span>
                  ),
                )}
              </>,
              p.grantCount,
              formatCurrency(p.vested),
            ]}
          />
        ))}
      </CalcTable>
      <div className="pt-3">
        <InlineLink
          to="/equity-grants"
          className="text-sm"
        >
          View all →
        </InlineLink>
      </div>
      {hasForwardVests ? (
        <InlineChart
          label="Vesting ahead (24 months)"
          testId="equity-forward-chart"
          data={forwardChart as unknown as Array<Record<string, number | string>>}
          xKey="label"
          series={[{ dataKey: 'cumulativeValue', label: 'Cumulative vesting', hero: true }]}
          yFormatter={formatCurrency}
        />
      ) : (
        <p className="text-xs text-muted-foreground">All grants fully vested.</p>
      )}
      <NotModeledDisclosure>
        <li>
          Vest-day ordinary income is an estimate of taxable income, not the tax your
          employer withholds — plan the cash separately.
        </li>
        {hasIso && (
          <li>
            ISO grants may trigger <TermTooltip term="AMT">AMT</TermTooltip> on exercise —
            the bargain element is an AMT preference item, not ordinary income.
          </li>
        )}
        <li>
          FMV is your stored estimate, not a live market price — private-company valuations
          move between 409A updates.
        </li>
      </NotModeledDisclosure>
    </CalculatorCard>
  );
}
