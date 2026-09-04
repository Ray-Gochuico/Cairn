import { describe, it, expect } from 'vitest';
import { DISCLOSURES } from '@/legal/disclosures';
import { TUITION_BASE_ACADEMIC_YEAR } from '@/data/tuition-reference';

describe('DISCLOSURES', () => {
  it('defines an app_wide disclosure with a version + body + checkbox label', () => {
    expect(DISCLOSURES.app_wide.version).toBe('1.5');
    expect(DISCLOSURES.app_wide.body.length).toBeGreaterThan(200);
    expect(DISCLOSURES.app_wide.acceptanceCheckboxLabel).toMatch(/at my own risk/i);
  });

  it('app_wide v1.5 body retains the UCC § 2-316 implied-warranty disclaimer + US-only scope + governing law', () => {
    const body = DISCLOSURES.app_wide.body;
    expect(body).toMatch(/MERCHANTABILITY/);
    expect(body).toMatch(/FITNESS FOR A PARTICULAR PURPOSE/);
    expect(body).toMatch(/NON-INFRINGEMENT/);
    expect(body).toMatch(/U\.S\.|U\.S\.-only|United States/);
    expect(body).toMatch(/governed by the laws/i);
  });

  it('app_wide v1.5 still names New York as the governing-law state', () => {
    const body = DISCLOSURES.app_wide.body;
    expect(body).not.toMatch(/\[PLACEHOLDER/i);
    expect(body).toMatch(/State of New York/);
  });

  it('app_wide v1.5 ships a diffFromPrevious that summarizes the drawdown gross-up + frozen-brackets additions', () => {
    expect(DISCLOSURES.app_wide.diffFromPrevious).toBeTruthy();
    expect(DISCLOSURES.app_wide.diffFromPrevious!.length).toBeGreaterThan(40);
    expect(DISCLOSURES.app_wide.diffFromPrevious).toMatch(/drawdown tax gross-up|gross.up/i);
    expect(DISCLOSURES.app_wide.diffFromPrevious).toMatch(/frozen.bracket|tax.tables|future.year/i);
  });

  it('app_wide v1.5 body lists the tax items the app does NOT model (Wave-3 Task 7, Wave-5 #7 refresh, Wave-7 v1.5 additions)', () => {
    const body = DISCLOSURES.app_wide.body;
    expect(body).toMatch(/What this app does NOT model/i);
    expect(body).toMatch(/AMT/);
    expect(body).toMatch(/RMD/);
    expect(body).toMatch(/§121|home sale exclusion/i);
    expect(body).toMatch(/SALT/i);
    expect(body).toMatch(/Social Security/i);
    expect(body).toMatch(/stock buyback|buyback excise/i);
    expect(body).toMatch(/cafeteria/i);
    expect(body).toMatch(/state.*(LTCG|capital.gain)/i);
  });

  it('app_wide v1.5 cites the current ~$278k WA cap-gains threshold (was stale ~$262k in v1.3)', () => {
    const body = DISCLOSURES.app_wide.body;
    expect(body).toMatch(/~\$?278k|\$278k/i);
    expect(body).not.toMatch(/~?\$?262k/i);
  });

  it('app_wide v1.5 body adds the drawdown tax gross-up bullet (W7-Legal addition)', () => {
    const body = DISCLOSURES.app_wide.body;
    expect(body).toMatch(/Drawdown tax gross-up/i);
    expect(body).toMatch(/grosses up withdrawal amounts/i);
    expect(body).toMatch(/Roth or after-tax balances/i);
  });

  it('app_wide v1.5 body adds the frozen tax brackets bullet (W7-Legal addition)', () => {
    const body = DISCLOSURES.app_wide.body;
    expect(body).toMatch(/Frozen tax brackets/i);
    expect(body).toMatch(/2026 tax year/i);
    expect(body).toMatch(/not auto-updated/i);
  });

  it('defines a roadmap disclosure with a version + body + checkbox label', () => {
    expect(DISCLOSURES.roadmap.version).toBe('1.0');
    expect(DISCLOSURES.roadmap.body.length).toBeGreaterThan(200);
    expect(DISCLOSURES.roadmap.acceptanceCheckboxLabel).toMatch(/algorithmic|consult/i);
  });

  it('app_wide disclosure body mentions the not-financial-advice framing', () => {
    expect(DISCLOSURES.app_wide.body).toMatch(/not financial.*advice/i);
  });

  it('roadmap disclosure body covers the named strategy traps', () => {
    const body = DISCLOSURES.roadmap.body;
    expect(body).toMatch(/backdoor roth/i);
    expect(body).toMatch(/mega backdoor/i);
    expect(body).toMatch(/wash-sale|wash sale/i);
    expect(body).toMatch(/HSA/);
  });

  it('defines a learning disclosure with a version + body + checkbox label', () => {
    expect(DISCLOSURES.learning.version).toBe('1.0');
    expect(DISCLOSURES.learning.body.length).toBeGreaterThan(200);
    expect(DISCLOSURES.learning.acceptanceCheckboxLabel).toMatch(/financial-literacy|not advice|verify/i);
  });

  it('every disclosure carries a non-empty title (DisclosureModal totality, TR-5)', () => {
    for (const d of Object.values(DISCLOSURES)) {
      expect(d.title).toBeTruthy();
    }
  });

  it('exposes exactly the five expected document IDs', () => {
    expect(Object.keys(DISCLOSURES).sort()).toEqual(['app_wide', 'backtest', 'interview', 'learning', 'roadmap']);
  });

  it('interview disclosure: v1.1 (T3 reference-data vintage), checkbox label pinned', () => {
    expect(DISCLOSURES.interview.version).toBe('1.1');
    expect(DISCLOSURES.interview.title).toBe('About the Frameworks');
    expect(DISCLOSURES.interview.acceptanceCheckboxLabel).toBe(
      'I understand these are mechanical frameworks applied to my numbers — educational, not personalized financial advice.',
    );
    expect(DISCLOSURES.interview.body).toContain('Mechanical frameworks, not advice');
    expect(DISCLOSURES.interview.body).toContain('Projections are not predictions');
  });

  it('interview 1.1 carries a re-prompt diff (house rule: body change ⇒ bump + diff)', () => {
    expect(DISCLOSURES.interview.diffFromPrevious).toContain('Reference data');
    expect(DISCLOSURES.interview.diffFromPrevious).toContain('re-read and re-accept');
  });

  it('interview body names the bundled dataset vintage (re-vintage without a bump trips here)', () => {
    expect(DISCLOSURES.interview.body).toContain(TUITION_BASE_ACADEMIC_YEAR);
  });
});

describe('backtest disclosure', () => {
  it('is registered at v1.4 with a non-empty body + acceptance label', () => {
    const d = DISCLOSURES.backtest;
    expect(d).toBeDefined();
    expect(d.version).toBe('1.4');
    expect(d.body.length).toBeGreaterThan(200);
    expect(d.acceptanceCheckboxLabel).toMatch(/not a prediction|historical outcomes/i);
  });

  it('leads with the count-not-probability + past-not-future framing', () => {
    const body = DISCLOSURES.backtest.body;
    expect(body).toMatch(/not a prediction|do not predict/i);
    expect(body).toMatch(/count of past outcomes|not a probability/i);
    expect(body).toMatch(/2026 levels|brackets are held/i);
  });

  it('v1.2 still describes returns as REAL total returns for a stock/bond blend (carried from v1.1; no longer "nominal index")', () => {
    const body = DISCLOSURES.backtest.body;
    // Engine drives blended REAL returns (Shiller real S&P + 10yr Treasury
    // deflated to real) across stocks + bonds — see src/lib/backtest/data.ts.
    expect(body).toMatch(/real \(CPI-adjusted\) total returns/i);
    expect(body).toMatch(/stock/i);
    expect(body).toMatch(/bond/i);
    // The pre-fix copy claimed "nominal index returns" — factually wrong.
    expect(body).not.toMatch(/nominal/i);
  });

  it('v1.2 states coverage ends in 2022, not "today" (M1 fix: Shiller data ends 2022)', () => {
    const body = DISCLOSURES.backtest.body;
    // The data asset ends at calendar 2022 (src/data/shiller.ts) — the copy
    // must not claim coverage "to today".
    expect(body).toMatch(/1871/);
    expect(body).toMatch(/2022/);
    expect(body).not.toMatch(/1871 to today/i);
  });

  it('v1.2 keeps example start years in range (no 2000 — out of range for a 30y horizon ending 2022)', () => {
    const body = DISCLOSURES.backtest.body;
    // Latest valid 30-year start is 1993 (1993 + 29 = 2022). "2000" would need
    // data through 2029 and is therefore an invalid illustrative start.
    expect(body).not.toMatch(/\b2000\b/);
  });

  it('ships a diffFromPrevious for the current version (house rule: body change ⇒ bump + diff)', () => {
    const diff = DISCLOSURES.backtest.diffFromPrevious;
    expect(diff).toBeTruthy();
    expect(diff).toMatch(/2022/); // names the same 1871-to-2022 dataset
    expect(diff).toContain('re-read and re-accept');
  });

  it('v1.4 covers all THREE surfaces and keeps W1’s scoped bracket line', () => {
    const body = DISCLOSURES.backtest.body;
    expect(body).toContain('Backtest tool');
    expect(body).toContain('Stress Test card');
    expect(body).toContain('applies no tax treatment');
    expect(body).toContain('history replayed, never a forecast');
    // W2's surface joined the enumeration at v1.4 (the v1.3 pin asserted its
    // ABSENCE — retargeted here, deliberately, by the wave that owns v1.4).
    expect(body).toMatch(/history view/i);
  });

  it('backtest v1.4 body names the History view surfaces and keeps the framing', () => {
    const body = DISCLOSURES.backtest.body;
    expect(body).toContain('History view');
    expect(body).toContain('Path to FI and Compound Interest');
    expect(body).toContain('never a probability');
    expect(body).toContain('not independent samples');
    // The v1.3 stress framing survives verbatim.
    expect(body).toContain('one sequence that happened once');
  });

  it('backtest v1.4 diff describes exactly the History addition against v1.3', () => {
    const diff = DISCLOSURES.backtest.diffFromPrevious!;
    expect(diff.length).toBeGreaterThan(40);
    expect(diff).toContain('History view');
    expect(diff).toContain('Path to FI');
    expect(diff).toContain('Compound Interest');
    expect(diff).toMatch(/Please re-read and re-accept\.$/);
    // References no OTHER change:
    expect(diff).toContain(
      'No change to the count-not-probability, overlapping-windows, real-returns, or gross-of-fees framing',
    );
  });

  it('backtest v1.4 keeps the acceptance checkbox label byte-identical to v1.3', () => {
    expect(DISCLOSURES.backtest.acceptanceCheckboxLabel).toBe(
      'I understand the backtest and stress test report historical outcomes only and are not a prediction of future performance.',
    );
  });
  /* W2 review fix (MINOR 9): the v1.4 edits were byte-exact against the copy
     contract but only CONTAINS-pinned, so one-word mutants in the consent text
     the user actually reads (the body paragraph and the diff box) survived
     every suite. The diff box IS consent copy: a bump without the matching
     literal change must red. */
  it('backtest v1.4 body carries the History paragraph byte-exact', () => {
    expect(DISCLOSURES.backtest.body).toContain(
      'The **History view** on the Path to FI and Compound Interest calculators replays a contribution plan (no withdrawals) against the same dataset: every full-length historical stretch at a fixed 75% stock / 25% bond real-return blend, rebalanced annually. At each year it reports the middle half (25th–75th percentile) and median of the balances those stretches had reached, and — where a target exists — a count of the stretches that reached the target within the horizon. The same rules apply: overlapping stretches are not independent samples, the count is a tally of past outcomes and never a probability, returns are real (CPI-adjusted) and gross of fees, and the view is history, not a forecast.',
    );
  });

  it('backtest v1.4 opening names the third surface byte-exact (the Edit-1 clause)', () => {
    const body = DISCLOSURES.backtest.body;
    expect(body).toContain('from 1871 to 2022, in three views. The **Backtest tool**');
    expect(body).toContain(
      ', and the **History view** on the Path to FI and Compound Interest calculators replays your contribution plan against every full-length stretch in the same dataset. All three are history replayed, never a forecast.',
    );
  });

  it('backtest v1.4 diffFromPrevious is the contract string, byte-exact', () => {
    expect(DISCLOSURES.backtest.diffFromPrevious).toBe(
      'Version 1.4 adds the History view on the Path to FI and Compound Interest calculators: the same 1871–2022 dataset now also drives an accumulation-side percentile band (the middle half and median across every full-length historical stretch) plus a reached-the-target count on those two cards. The opening now names those surfaces alongside the surfaces named in v1.3. No change to the count-not-probability, overlapping-windows, real-returns, or gross-of-fees framing carried over from v1.3. Please re-read and re-accept.',
    );
  });
});
