import { describe, it, expect } from 'vitest';
import { buildFrameworkCards, recordUnallocatableMax } from '@/lib/interview/framework-cards';
import { AccountType, AssetClass } from '@/types/enums';
import { makeAccount, makeHolding, makeLoan } from '../../factories';
import { fixtureCtx, snap } from './fixture';

describe('buildFrameworkCards', () => {
  const cards = buildFrameworkCards({ amountCents: 1_000_000, cadence: 'one-time' }, fixtureCtx());

  it('three cards in policy order with the CI-4 titles', () => {
    expect(cards.map((c) => c.title)).toEqual([
      'Conservative — "Safety first."',
      'Moderate — "The standard order."',
      'Aggressive — "Growth-weighted."',
    ]);
  });

  it('rows carry CI-7 labels + formatted amounts and sum to the input', () => {
    expect(cards[0].rows).toEqual([
      { label: 'High-rate debt (≥ 8%)', amount: '$3,000' },
      { label: 'Emergency fund — to 6× expenses', amount: '$6,000' },
      { label: 'Debt in the 5–8% band', amount: '$1,000' },
    ]);
  });

  it('assumes groups: provenance only when a projection rendered; constants; skipped reasons', () => {
    const aggressive = cards[2]; // invest headline → projection → CI-22 present
    expect(aggressive.assumes.some((a) => a.group === 'provenance' && a.text.startsWith('Growth: 6% nominal'))).toBe(true);
    expect(aggressive.assumes.some((a) => a.group === 'constants' && a.text === 'Debt bands: 5% and 8% — app defaults.')).toBe(true);
    expect(aggressive.assumes.some((a) => a.group === 'skipped' && a.text === 'Debt between 5–8% stays at minimum payments in this framework.')).toBe(true);
    const conservative = cards[0]; // EF headline, no projection → no CI-22
    expect(conservative.assumes.some((a) => a.group === 'provenance' && a.text.startsWith('Growth:'))).toBe(false);
  });

  it('the fixed footer is on every card (CI-5)', () => {
    for (const c of cards) {
      expect(c.footer).toBe('One mechanical framework applied to your numbers — not advice, not a recommendation.');
    }
  });

  it('Moderate assumed 6× → CI-26 row + the inline jobStability ask target', () => {
    const moderate = cards[1];
    expect(moderate.assumes.some((a) => a.text === 'Assumes a 6× expense reserve — no job-stability answer on file. Answer below to use 3×.')).toBe(true);
    expect(moderate.askJobStability).toEqual({ personId: 1, name: fixtureCtx().persons[0].name });
  });

  it('B6 with no targets stays one Invest row + CI-20', () => {
    const aggressive = cards[2];
    expect(aggressive.rows.find((r) => r.label === 'Invest')).toBeDefined();
    expect(aggressive.assumes.some((a) => a.text === 'No target allocation set — shown as one investing amount.')).toBe(true);
  });
});

describe('B6 per-class rows use the house labels (review M2)', () => {
  const targetedCtx = () => fixtureCtx({
    loans: [],
    accounts: [
      ...fixtureCtx().accounts,
      makeAccount({ id: 3, type: AccountType.ACCOUNT_BROKERAGE, name: 'Brokerage' }),
    ],
    snapshots: [...fixtureCtx().snapshots, snap(3, 10000)],
    holdings: [makeHolding({ accountId: 3, ticker: 'VTI', shareCount: 10 })],
    tickers: [{ ticker: 'VTI', assetClass: 'US_TOTAL_MARKET' }] as never,
    settings: {
      assetClassTargetAllocations: [
        { assetClass: 'US_TOTAL_MARKET', targetPct: 0.6 },
        { assetClass: 'US_BONDS', targetPct: 0.4 },
      ],
    } as never,
  });

  it('CI-7: Invest rows carry ASSET_CLASS_LABEL names, never raw enum strings', () => {
    const cards = buildFrameworkCards({ amountCents: 1_000_000, cadence: 'one-time' }, targetedCtx());
    const aggressive = cards[2];
    const labels = aggressive.rows.map((r) => r.label);
    expect(labels).toContain('Invest — US Total Market');
    expect(labels.join('\n')).not.toContain('US_TOTAL_MARKET');
  });

  it("CB-9: the no-held-fund row carries that class's dollars, house-labeled", () => {
    // HAND-COMPUTED from targetedCtx() + the aggressive one-time split:
    //   accounts cash = 22,000 + 8,000 = 30,000 ≥ aggressive EF 3×6,000 =
    //   18,000 → covered; loans [] → the whole $10,000 invests.
    //   valuations: VTI $10,000 (account 3 snapshot spread over its only
    //   holding) → householdTotal 10,000; postTotal = 10,000 + 10,000 cash
    //   = 20,000. US_BONDS target 0.4 × 20,000 = 8,000, current $0 → need
    //   8,000; US_TOTAL_MARKET need 12,000 − 10,000 = 2,000; totalNeed
    //   10,000 ≤ cash → full-fund → bonds budget = 8,000; no held bonds
    //   ticker → unallocatable { US_BONDS, need: 8000 } → $8,000.
    const cards = buildFrameworkCards({ amountCents: 1_000_000, cadence: 'one-time' }, targetedCtx());
    const aggressive = cards[2];
    expect(aggressive.assumes.some((a) =>
      a.text === 'No held fund for US Bonds — $8,000 stays as unallocated cash.',
    )).toBe(true);
    // House idiom: raw enum spellings never render.
    expect(aggressive.assumes.some((a) => a.text.includes('US_BONDS'))).toBe(false);
    // The old dollar-less joined form is gone.
    expect(aggressive.assumes.some((a) =>
      a.text === 'No held fund for US Bonds — that part stays as unallocated cash.',
    )).toBe(false);
  });

  it('CB-9 per-month: one row per class, /mo suffix, deduped across phases (D-WA12)', () => {
    // $500/mo: every framework's Ongoing phase invests the full $500 (EF
    // covered or reached), so the per-class MAX across invocations is $500
    // for all three cards — ONE distinct text with the /mo unit.
    const cards = buildFrameworkCards({ amountCents: 50_000, cadence: 'per-month' }, targetedCtx());
    const rows = cards
      .flatMap((c) => c.assumes)
      .filter((a) => a.text.startsWith('No held fund for US Bonds'));
    const texts = [...new Set(rows.map((r) => r.text))];
    expect(texts).toHaveLength(1);                       // ONE row per class per card set…
    expect(texts[0]).toMatch(/ — \$[\d,]+\/mo stays as unallocated cash\.$/); // …with the /mo unit
  });

  it('D-WA12 collector policy: recordUnallocatableMax keeps the max, both orders (review MAJOR)', () => {
    // Direct pin of the extracted policy — the fixture-shaped suites let a
    // first-seen mutant survive (single-invocation one-time; equal-phase
    // per-month). Two unequal needs for ONE class, both arrival orders:
    const grows = new Map<AssetClass, number>();
    recordUnallocatableMax(grows, [{ assetClass: AssetClass.US_BONDS, need: 250 }]);
    recordUnallocatableMax(grows, [{ assetClass: AssetClass.US_BONDS, need: 500 }]);
    expect(grows.get(AssetClass.US_BONDS)).toBe(500); // larger-later (kills first-seen, min-seen)

    const shrinks = new Map<AssetClass, number>();
    recordUnallocatableMax(shrinks, [{ assetClass: AssetClass.US_BONDS, need: 500 }]);
    recordUnallocatableMax(shrinks, [{ assetClass: AssetClass.US_BONDS, need: 250 }]);
    expect(shrinks.get(AssetClass.US_BONDS)).toBe(500); // larger-first (kills last-seen, min-seen)

    // Classes stay independent.
    recordUnallocatableMax(shrinks, [{ assetClass: AssetClass.CRYPTO, need: 10 }]);
    expect(shrinks.get(AssetClass.US_BONDS)).toBe(500);
    expect(shrinks.get(AssetClass.CRYPTO)).toBe(10);
  });

  it('D-WA12 discriminating scenario: phases invest DIFFERENT amounts — the Ongoing max renders (review MAJOR)', () => {
    // The verifiers’ non-equivalence shape: Moderate + ONE mid-band 6% loan
    // + targets + no held bond fund + $500/mo. Moderate splits the
    // post-EF-target remainder 50/50 debt/invest, so the debt-phase invest
    // is $250/mo while the Ongoing (post-payoff) phase invests the full
    // $500/mo — investRows sees UNEQUAL needs for US_BONDS across phases.
    //
    // HAND-COMPUTED needs (allocateContribution per invocation):
    //   valuations: VTI $10,000 only → US_TOTAL_MARKET is overweight in
    //   both phases (current $10,000 > 0.6 × postTotal), need 0.
    //   Debt phase:   cash 250 → postTotal 10,250 → US_BONDS target
    //                 0.4×10,250 = 4,100 > 250 → bonds gets ALL 250.
    //   Ongoing:      cash 500 → postTotal 10,500 → bonds target 4,200
    //                 > 500 → bonds gets ALL 500.
    //   max(250, 500) = 500 → '$500/mo'. A first-seen collector renders
    //   '$250/mo' — a 2× wrong user-visible dollar (the upheld MAJOR).
    const ctx = fixtureCtx({
      loans: [
        makeLoan({ id: 1, name: 'HELOC', currentBalance: 8000, interestRate: 0.06, monthlyPayment: 200, termMonths: 120, firstPaymentDate: '2026-01-01' }),
      ],
      accounts: [
        ...fixtureCtx().accounts,
        makeAccount({ id: 3, type: AccountType.ACCOUNT_BROKERAGE, name: 'Brokerage' }),
      ],
      snapshots: [...fixtureCtx().snapshots, snap(3, 10000)],
      holdings: [makeHolding({ accountId: 3, ticker: 'VTI', shareCount: 10 })],
      tickers: [{ ticker: 'VTI', assetClass: 'US_TOTAL_MARKET' }] as never,
      settings: {
        assetClassTargetAllocations: [
          { assetClass: 'US_TOTAL_MARKET', targetPct: 0.6 },
          { assetClass: 'US_BONDS', targetPct: 0.4 },
        ],
      } as never,
    });
    const cards = buildFrameworkCards({ amountCents: 50_000, cadence: 'per-month' }, ctx);
    const moderate = cards[1];
    const bondRows = moderate.assumes.filter((a) => a.text.startsWith('No held fund for US Bonds'));
    expect(bondRows.map((r) => r.text)).toEqual([
      'No held fund for US Bonds — $500/mo stays as unallocated cash.',
    ]);
  });
});

describe('CI-25 avalanche assume row (review m1)', () => {
  it('fires when the multi-loan band funds in a LATER phase (EF-first schedule)', () => {
    // Two mid-band loans; Conservative per-month: phase 1 is the EF target,
    // the mid band funds in phase 2 — the avalanche tie-break row must still
    // render (funded-ness is judged across every phase, not phase 1 only).
    const ctx = fixtureCtx({
      loans: [
        makeLoan({ id: 1, name: 'HELOC', currentBalance: 8000, interestRate: 0.07, monthlyPayment: 200, termMonths: 120, firstPaymentDate: '2026-01-01' }),
        makeLoan({ id: 2, name: 'Consolidation', currentBalance: 5000, interestRate: 0.06, monthlyPayment: 150, termMonths: 60, firstPaymentDate: '2026-01-01' }),
      ],
    });
    const cards = buildFrameworkCards({ amountCents: 100_000, cadence: 'per-month' }, ctx);
    const conservative = cards[0];
    // Shape sanity: the EF phase precedes the mid-band phase.
    expect(conservative.phases[0].rows.some((r) => r.label.startsWith('Emergency fund'))).toBe(true);
    expect(conservative.assumes.some((a) =>
      a.text === 'Multiple loans pay highest rate first; rate ties go to the smaller balance, then the lower ID.')).toBe(true);
  });
});
