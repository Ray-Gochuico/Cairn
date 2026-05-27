import { describe, it, expect } from 'vitest';
import { DISCLOSURES } from '@/legal/disclosures';

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

  it('exposes only the two expected document IDs', () => {
    expect(Object.keys(DISCLOSURES).sort()).toEqual(['app_wide', 'roadmap']);
  });
});
