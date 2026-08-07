import { describe, it, expect } from 'vitest';
import { buildFrameworkCards } from '@/lib/interview/framework-cards';
import { AccountType } from '@/types/enums';
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

  it('CI-21: the no-held-fund class list is human-labeled', () => {
    const cards = buildFrameworkCards({ amountCents: 1_000_000, cadence: 'one-time' }, targetedCtx());
    const aggressive = cards[2];
    expect(aggressive.assumes.some((a) =>
      a.text === 'No held fund for US Bonds — that part stays as unallocated cash.')).toBe(true);
    expect(aggressive.assumes.some((a) => a.text.includes('US_BONDS'))).toBe(false);
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
