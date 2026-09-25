import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
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

  it('interview disclosure: v1.2 (R4 market history), title + checkbox label unchanged', () => {
    expect(DISCLOSURES.interview.version).toBe('1.2');
    expect(DISCLOSURES.interview.title).toBe('About the Frameworks');
    expect(DISCLOSURES.interview.acceptanceCheckboxLabel).toBe(
      'I understand these are mechanical frameworks applied to my numbers — educational, not personalized financial advice.',
    );
    expect(DISCLOSURES.interview.body).toContain('Mechanical frameworks, not advice');
    expect(DISCLOSURES.interview.body).toContain('Projections are not predictions');
    expect(DISCLOSURES.interview.body).toContain('**Reference data.**'); // the 1.1 paragraph survives
  });

  it('interview 1.2 body carries the Market history paragraph byte-exact (the paragraph the consent describes)', () => {
    expect(DISCLOSURES.interview.body).toContain(
      "**Market history.** The market-stress question replays your portfolio through named windows of U.S. market history — the 1871–2022 replay described in the Historical Backtest disclosure: real (CPI-adjusted) stock and bond total returns, blended at the stock share you chose and rebalanced annually, gross of fees, with no tax treatment. A named window is one sequence that happened once — history replayed, never a forecast and never a probability. Its retirement line is the same whole-year solve as the Earliest Retirement calculator, run twice from the window's last year with your assumed path resumed from the window's end balance; the historical years after the window are not part of that reading, and it states a difference in years, not a date. It uses your saved inputs — edits in the Calculators scenario bar do not apply here.",
    );
    // The paragraph sits between Reference data and the closing sentence.
    const b = DISCLOSURES.interview.body;
    expect(b.indexOf('**Reference data.**')).toBeLessThan(b.indexOf('**Market history.**'));
    expect(b.indexOf('**Market history.**')).toBeLessThan(b.indexOf('Decisions about debt, investing, and reserves belong with you'));
  });

  it('interview 1.2 diffFromPrevious is the contract string, byte-exact', () => {
    expect(DISCLOSURES.interview.diffFromPrevious).toBe(
      "Version 1.2 adds a 'Market history' paragraph: the new market-stress question replays your portfolio through named windows of the 1871–2022 replay described in the Historical Backtest disclosure (real stock and bond returns, blended and rebalanced annually) — history that happened once, not a forecast or a probability — and its retirement line is the Earliest Retirement calculator's solve run from each window's last year, stated as a difference in years. No other content changes since v1.1. Please re-read and re-accept.",
    );
  });

  /* The R3 idiom: the body's SHA-256 + length are machine-checked so a one-
     character edit reds this pin; the protocol answer is a bump + a diff that
     names the edit + a re-pin here. Recompute with the command in the backtest
     block above, swapping `backtest` for `interview`. */
  it('interview 1.2 body is byte-pinned (length 2577, SHA-256)', () => {
    const body = DISCLOSURES.interview.body;
    expect(body.length).toBe(2577);
    expect(createHash('sha256').update(body, 'utf8').digest('hex')).toBe(
      '02472806625f8277c1043fd06c43b4592298e499f1ae34a57d9520eb05a91c51',
    );
  });

  it('the backtest document is NOT bumped by R4 (its "three views" sentence describes that document)', () => {
    expect(DISCLOSURES.backtest.version).toBe('1.5');
    expect(DISCLOSURES.backtest.body.length).toBe(3392);
  });

  it('interview body names the bundled dataset vintage (re-vintage without a bump trips here)', () => {
    expect(DISCLOSURES.interview.body).toContain(TUITION_BASE_ACADEMIC_YEAR);
  });
});

describe('backtest disclosure', () => {
  it('is registered at v1.5 with a non-empty body + acceptance label', () => {
    const d = DISCLOSURES.backtest;
    expect(d).toBeDefined();
    expect(d.version).toBe('1.5');
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

  // v1.5 (R3) bumped for the LABEL; the body is still v1.4's text. The body
  // pins below keep their v1.4 titles on purpose — they describe the text.
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

  it('backtest v1.5 diff describes exactly the label widening against v1.4 — and nothing else', () => {
    const diff = DISCLOSURES.backtest.diffFromPrevious!;
    expect(diff.length).toBeGreaterThan(40);
    expect(diff).toContain('acceptance checkbox');
    expect(diff).toContain('Backtest tool');
    expect(diff).toContain('Stress Test card');
    expect(diff).toContain('History view');
    expect(diff).toContain('The body is unchanged from v1.4.');
    expect(diff).toMatch(/Please re-read and re-accept\.$/);
  });

  it('backtest v1.5 acceptance checkbox label is the contract string (CR-R3-1), byte-exact, naming the body’s three views', () => {
    const label = DISCLOSURES.backtest.acceptanceCheckboxLabel;
    expect(label).toBe(
      'I understand the Backtest tool, the Stress Test card, and the History view report historical outcomes only and are not a prediction of future performance.',
    );
    // The label's nouns are the body's own bold nouns — the label names what the body names.
    for (const noun of ['Backtest tool', 'Stress Test card', 'History view']) {
      expect(label).toContain(noun);
      expect(DISCLOSURES.backtest.body).toContain(`**${noun}**`);
    }
    // v1.4's tail is carried byte-identically: the widening added nouns and nothing else.
    expect(
      label.endsWith(' report historical outcomes only and are not a prediction of future performance.'),
    ).toBe(true);
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

  it('backtest v1.5 diffFromPrevious is the contract string (CR-R3-2), byte-exact', () => {
    expect(DISCLOSURES.backtest.diffFromPrevious).toBe(
      'Version 1.5 changes only the acceptance checkbox: it now names all three views of the 1871–2022 replay that this document covers — the Backtest tool, the Stress Test card, and the History view — where the v1.4 checkbox named only the backtest and stress test. The body is unchanged from v1.4. Please re-read and re-accept.',
    );
  });

  /* R3 (v1.7.0): v1.5 bumped for a LABEL change; its diff says "The body is
     unchanged from v1.4." That sentence is machine-checked here — the body's
     SHA-256 and length at v1.4 (identical from ed659f7a through 2cde688c).
     A one-character body edit reds this pin; the protocol answer is a bump +
     a diff that names the edit + a re-pin here. Recompute:
       node --input-type=module -e "const m=await import('file://'+process.cwd()+'/src/legal/disclosures.ts');const{createHash}=await import('node:crypto');const b=m.DISCLOSURES.backtest.body;console.log(b.length,createHash('sha256').update(b,'utf8').digest('hex'))" */
  it('backtest v1.5 body is byte-identical to v1.4 (the diff’s "unchanged" claim, machine-checked)', () => {
    const body = DISCLOSURES.backtest.body;
    expect(body.length).toBe(3392);
    expect(createHash('sha256').update(body, 'utf8').digest('hex')).toBe(
      'ded82e5e310e0cb4403eafb0dc0014d72a88c6dc525b1badae189e695a765b73',
    );
  });
});
