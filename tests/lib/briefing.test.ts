import { describe, it, expect } from 'vitest';
import {
  briefingHeading,
  endOfLastMonthIso,
  monthName,
  rollVisitStamps,
} from '@/lib/briefing';

describe('rollVisitStamps', () => {
  it('first-ever open: stamps today, no baseline, last-month mode', () => {
    const r = rollVisitStamps({ lastVisitDate: null, briefingBaselineDate: null }, '2026-07-09');
    expect(r).toEqual({
      stamps: { lastVisitDate: '2026-07-09', briefingBaselineDate: null },
      changed: true,
      baselineIso: null,
      mode: 'last-month',
    });
  });

  it('first open of a new day: baseline becomes the previous visit day', () => {
    const r = rollVisitStamps(
      { lastVisitDate: '2026-07-06', briefingBaselineDate: '2026-07-01' },
      '2026-07-09',
    );
    expect(r.stamps).toEqual({ lastVisitDate: '2026-07-09', briefingBaselineDate: '2026-07-06' });
    expect(r.changed).toBe(true);
    expect(r.baselineIso).toBe('2026-07-06');
    expect(r.mode).toBe('last-visit');
  });

  it('same-day re-open: stamps unchanged, baseline stable all day', () => {
    const r = rollVisitStamps(
      { lastVisitDate: '2026-07-09', briefingBaselineDate: '2026-07-06' },
      '2026-07-09',
    );
    expect(r.changed).toBe(false);
    expect(r.stamps).toEqual({ lastVisitDate: '2026-07-09', briefingBaselineDate: '2026-07-06' });
    expect(r.baselineIso).toBe('2026-07-06');
    expect(r.mode).toBe('last-visit');
  });

  it('a not-strictly-past baseline (clock skew / first roll of day 2) falls back to last-month mode', () => {
    // Day 2 of app life: yesterday's roll left baseline null.
    const r1 = rollVisitStamps({ lastVisitDate: '2026-07-08', briefingBaselineDate: null }, '2026-07-09');
    expect(r1.mode).toBe('last-visit'); // baseline 2026-07-08 IS strictly past
    // Clock rolled backwards past the stamp: never compare today to the future.
    const r2 = rollVisitStamps({ lastVisitDate: '2026-07-01', briefingBaselineDate: '2026-07-20' }, '2026-07-09');
    expect(r2.mode).toBe('last-month');
    expect(r2.baselineIso).toBeNull();
  });
});

describe('endOfLastMonthIso', () => {
  const d = (iso: string) => {
    const [y, m, day] = iso.split('-').map(Number);
    return new Date(y, m - 1, day); // local, matching lastMonthYyyymm's getters
  };
  it('mid-month → last calendar day of the previous month', () => {
    expect(endOfLastMonthIso(d('2026-07-09'))).toBe('2026-06-30');
  });
  it('January rolls to previous December', () => {
    expect(endOfLastMonthIso(d('2026-01-15'))).toBe('2025-12-31');
  });
  it('month-length edge: Mar 31 → Feb 28 (non-leap)', () => {
    expect(endOfLastMonthIso(d('2026-03-31'))).toBe('2026-02-28');
  });
});

describe('monthName / briefingHeading', () => {
  it('names the YYYY-MM month', () => {
    expect(monthName('2026-06')).toBe('June');
    expect(monthName('2025-12')).toBe('December');
  });
  it('heading is the spec title in last-visit mode, the month otherwise', () => {
    expect(briefingHeading('last-visit', '2026-06')).toBe('Since your last visit');
    expect(briefingHeading('last-month', '2026-06')).toBe('Since June');
  });
});

// ---------------------------------------------------------------------------
// buildBriefing — the ranked-row selector (Task 3)
// ---------------------------------------------------------------------------
import { buildBriefing, briefingRowText, type BriefingInput } from '@/lib/briefing';

/** A quiet baseline input — no row fires; tests override one signal at a time. */
function quietInput(overrides: Partial<BriefingInput> = {}): BriefingInput {
  return {
    netWorth: { current: 100_000, baseline: 100_000 },
    concentration: null,
    spending: { currentMonthTotal: 450, previousMonthTotal: 1_200 },
    monthly: { pending: false, monthToClose: '2026-06', balancesToConfirm: 0, loanPaymentsToRecord: 0 },
    goals: [],
    nextMove: null,
    ...overrides,
  };
}

describe('buildBriefing — net worth row + materiality floor', () => {
  it('material gain: exact copy, positive tone, emphasized amount', () => {
    const b = buildBriefing(quietInput({ netWorth: { current: 225_000, baseline: 207_000 } }));
    expect(b.rows.map((r) => r.id)).toEqual(['net-worth']);
    const row = b.rows[0];
    expect(briefingRowText(row)).toBe('Net worth is up +$18,000 (+8.7%).');
    expect(row.tone).toBe('positive');
    expect(row.href).toBe('/net-worth');
    expect(row.parts.find((p) => p.emphasis)?.text).toBe('+$18,000 (+8.7%)');
    expect(row.householdScoped).toBe(false);
    expect(b.empty).toBeNull();
  });

  it('a dip is information, not alarm: tone neutral, never negative', () => {
    const b = buildBriefing(quietInput({ netWorth: { current: 1_988_000, baseline: 2_000_000 } }));
    expect(briefingRowText(b.rows[0])).toBe('Net worth is down -$12,000 (-0.6%).');
    expect(b.rows[0].tone).toBe('neutral');
  });

  it('tiny dip below the $500 absolute floor: NO row; empty state says steady', () => {
    const b = buildBriefing(quietInput({ netWorth: { current: 99_700, baseline: 100_000 } }));
    expect(b.rows).toEqual([]);
    expect(b.empty).toEqual({
      title: 'Nothing needs your attention.',
      detail: 'Net worth is holding steady.',
    });
  });

  it('relative floor scales for large portfolios: $8k on $2M (0.4%) is below floor', () => {
    const b = buildBriefing(quietInput({ netWorth: { current: 2_008_000, baseline: 2_000_000 } }));
    expect(b.rows).toEqual([]);
    // …but 0.6% clears it:
    const b2 = buildBriefing(quietInput({ netWorth: { current: 2_012_000, baseline: 2_000_000 } }));
    expect(b2.rows.map((r) => r.id)).toEqual(['net-worth']);
  });

  it('percent-honesty guard verbatim: non-positive baseline → dollar delta only, no percent', () => {
    const b = buildBriefing(quietInput({ netWorth: { current: 2_000, baseline: -5_000 } }));
    expect(briefingRowText(b.rows[0])).toBe('Net worth is up +$7,000.');
  });

  it('no history (null current or baseline) → no row and NO steady claim', () => {
    const b = buildBriefing(quietInput({ netWorth: { current: null, baseline: null } }));
    expect(b.rows).toEqual([]);
    expect(b.empty).toEqual({ title: 'Nothing needs your attention.', detail: null });
  });
});

describe('buildBriefing — concentration note (calm-ethos verbatim)', () => {
  it('keeps the spec copy verbatim above the soft threshold', () => {
    const b = buildBriefing(quietInput({ concentration: { ticker: 'BND', pctOfPortfolio: 0.177 } }));
    expect(b.rows.map((r) => r.id)).toEqual(['concentration']);
    expect(briefingRowText(b.rows[0])).toBe(
      'BND is 17.7% of your effective exposure. Note — not a warning.',
    );
    expect(b.rows[0].tone).toBe('note');
    expect(b.rows[0].href).toBe('/investments#concentration');
    expect(b.rows[0].linkLabel).toBe('See breakdown');
    expect(b.rows[0].householdScoped).toBe(true);
  });

  it('mirrors PER_TICKER_SOFT exactly: 15.0% is NOT noteworthy, 15.1% is', () => {
    expect(
      buildBriefing(quietInput({ concentration: { ticker: 'VTI', pctOfPortfolio: 0.15 } })).rows,
    ).toEqual([]);
    expect(
      buildBriefing(quietInput({ concentration: { ticker: 'VTI', pctOfPortfolio: 0.151 } })).rows,
    ).toHaveLength(1);
  });
});

describe('buildBriefing — spending absence (neutral, never a nag)', () => {
  it('fires only when spending history exists but this month is empty', () => {
    const b = buildBriefing(quietInput({ spending: { currentMonthTotal: 0, previousMonthTotal: 1_200 } }));
    expect(briefingRowText(b.rows[0])).toBe("This month's spending isn't in yet.");
    expect(b.rows[0].tone).toBe('neutral');
    expect(b.rows[0].href).toBe('/spending');
  });
  it('never nags a user who does not track spending', () => {
    const b = buildBriefing(quietInput({ spending: { currentMonthTotal: 0, previousMonthTotal: 0 } }));
    expect(b.rows).toEqual([]);
  });
});

describe('buildBriefing — Monthly cadence action row (the Statement composability note)', () => {
  it('renders counts with the spec phrasing', () => {
    const b = buildBriefing(quietInput({
      monthly: { pending: true, monthToClose: '2026-06', balancesToConfirm: 3, loanPaymentsToRecord: 2 },
    }));
    expect(b.rows.map((r) => r.id)).toEqual(['monthly-close']);
    expect(briefingRowText(b.rows[0])).toBe('Close June — confirm 3 balances, record 2 loan payments.');
    expect(b.rows[0].tone).toBe('action');
    expect(b.rows[0].href).toBe('/monthly');
  });
  it('singular forms and single-clause variants', () => {
    const one = buildBriefing(quietInput({
      monthly: { pending: true, monthToClose: '2026-06', balancesToConfirm: 1, loanPaymentsToRecord: 0 },
    }));
    expect(briefingRowText(one.rows[0])).toBe('Close June — confirm 1 balance.');
    const loansOnly = buildBriefing(quietInput({
      monthly: { pending: true, monthToClose: '2026-06', balancesToConfirm: 0, loanPaymentsToRecord: 1 },
    }));
    expect(briefingRowText(loansOnly.rows[0])).toBe('Close June — record 1 loan payment.');
  });
  it('day-1 pending with nothing itemized still gets a calm review row', () => {
    const b = buildBriefing(quietInput({
      monthly: { pending: true, monthToClose: '2026-06', balancesToConfirm: 0, loanPaymentsToRecord: 0 },
    }));
    expect(briefingRowText(b.rows[0])).toBe("Close June — review this month's check-in.");
  });
  it('not pending → no row', () => {
    expect(buildBriefing(quietInput()).rows).toEqual([]);
  });
});

describe('buildBriefing — next-move action row (NextMove demoted into the feed)', () => {
  it('setup state', () => {
    const b = buildBriefing(quietInput({ nextMove: { kind: 'setup' } }));
    expect(briefingRowText(b.rows[0])).toBe('Suggested next step: finish setting up.');
    expect(b.rows[0].href).toBe('/setup');
    expect(b.rows[0].householdScoped).toBe(true);
  });
  it('disclosure state', () => {
    const b = buildBriefing(quietInput({ nextMove: { kind: 'disclosure' } }));
    expect(briefingRowText(b.rows[0])).toBe('Suggested next step: set up your roadmap.');
    expect(b.rows[0].href).toBe('/roadmap');
  });
  it('active node routes to the node CTA', () => {
    const b = buildBriefing(quietInput({
      nextMove: { kind: 'active', title: 'Max your employer 401(k) match', href: '/inputs/contributions', ctaLabel: 'Review contributions' },
    }));
    expect(briefingRowText(b.rows[0])).toBe('Suggested next step: Max your employer 401(k) match.');
    expect(b.rows[0].href).toBe('/inputs/contributions');
    expect(b.rows[0].linkLabel).toBe('Review contributions');
  });
  it('caught up (null) → no row; the empty state is the celebration', () => {
    const b = buildBriefing(quietInput({ nextMove: null }));
    expect(b.rows).toEqual([]);
    expect(b.empty?.title).toBe('Nothing needs your attention.');
  });
});

describe('buildBriefing — goal-reached row', () => {
  it('one positive row for the first reached goal, ranked after a net-worth move', () => {
    const b = buildBriefing(quietInput({
      netWorth: { current: 225_000, baseline: 207_000 },
      goals: [
        { id: 7, name: 'Emergency fund', percentComplete: 1.04 },
        { id: 9, name: 'House fund', percentComplete: 1.2 },
      ],
    }));
    expect(b.rows.map((r) => r.id)).toEqual(['net-worth', 'goal-reached-7']);
    expect(briefingRowText(b.rows[1])).toBe("You've reached your Emergency fund goal.");
    expect(b.rows[1].tone).toBe('positive');
    expect(b.rows[1].href).toBe('/goals');
  });
  it('99.9% is not reached', () => {
    const b = buildBriefing(quietInput({ goals: [{ id: 1, name: 'X', percentComplete: 0.999 }] }));
    expect(b.rows).toEqual([]);
  });
});

describe('buildBriefing — deterministic ordering and the 4-row cap', () => {
  const everything = (): BriefingInput => quietInput({
    netWorth: { current: 225_000, baseline: 207_000 },              // positive
    concentration: { ticker: 'BND', pctOfPortfolio: 0.177 },        // note
    spending: { currentMonthTotal: 0, previousMonthTotal: 1_200 },  // neutral
    monthly: { pending: true, monthToClose: '2026-06', balancesToConfirm: 3, loanPaymentsToRecord: 2 },
    nextMove: { kind: 'active', title: 'Build a 3-month emergency fund', href: '/roadmap' },
  });

  it('positive leads, note next, actions last; the lowest-ranked informational row is capped out', () => {
    const b = buildBriefing(everything());
    // 3 informational candidates + 2 actions → 2 informational slots:
    expect(b.rows.map((r) => r.id)).toEqual([
      'net-worth',        // positive
      'concentration',    // note
      'monthly-close',    // action, materiality 100
      'next-move',        // action, materiality 50
    ]);
    expect(b.rows).toHaveLength(4);
    expect(b.empty).toBeNull();
  });

  it('actions are NEVER dropped by the cap', () => {
    const b = buildBriefing(everything());
    expect(b.rows.filter((r) => r.tone === 'action')).toHaveLength(2);
  });

  it('with no actions, up to 4 informational rows survive', () => {
    const b = buildBriefing({ ...everything(), monthly: { ...everything().monthly, pending: false }, nextMove: null });
    expect(b.rows.map((r) => r.id)).toEqual(['net-worth', 'concentration', 'spending-missing']);
  });
});

describe('buildBriefing — the withView mapper (person-scope honesty, W10 S1)', () => {
  it('applies to view-respecting rows only — never to household-scoped or /monthly hrefs', () => {
    const withView = (p: string) => `${p}?view=p1`;
    const b = buildBriefing({
      ...quietInput({
        netWorth: { current: 225_000, baseline: 207_000 },
        concentration: { ticker: 'BND', pctOfPortfolio: 0.177 },
        spending: { currentMonthTotal: 0, previousMonthTotal: 1_200 },
        monthly: { pending: true, monthToClose: '2026-06', balancesToConfirm: 1, loanPaymentsToRecord: 0 },
        goals: [{ id: 7, name: 'Emergency fund', percentComplete: 1.1 }],
      }),
      withView,
    });
    const href = (id: string) => b.rows.find((r) => r.id === id)!.href;
    expect(href('net-worth')).toBe('/net-worth?view=p1');
    expect(href('goal-reached-7')).toBe('/goals?view=p1');
    expect(href('concentration')).toBe('/investments#concentration'); // household-scoped
    expect(href('monthly-close')).toBe('/monthly');                    // ritual is one place
  });
});
