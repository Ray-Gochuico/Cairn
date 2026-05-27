import { describe, it, expect } from 'vitest';
import { DISCLOSURES } from '@/legal/disclosures';

describe('DISCLOSURES', () => {
  it('defines an app_wide disclosure with a version + body + checkbox label', () => {
    expect(DISCLOSURES.app_wide.version).toBe('1.1');
    expect(DISCLOSURES.app_wide.body.length).toBeGreaterThan(200);
    expect(DISCLOSURES.app_wide.acceptanceCheckboxLabel).toMatch(/at my own risk/i);
  });

  it('app_wide v1.1 body adds the UCC § 2-316 implied-warranty disclaimer + US-only scope + governing law', () => {
    const body = DISCLOSURES.app_wide.body;
    expect(body).toMatch(/MERCHANTABILITY/);
    expect(body).toMatch(/FITNESS FOR A PARTICULAR PURPOSE/);
    expect(body).toMatch(/NON-INFRINGEMENT/);
    expect(body).toMatch(/U\.S\.|U\.S\.-only|United States/);
    expect(body).toMatch(/governed by the laws/i);
  });

  it('app_wide v1.1 ships a diffFromPrevious so the re-prompt explains what changed', () => {
    expect(DISCLOSURES.app_wide.diffFromPrevious).toBeTruthy();
    expect(DISCLOSURES.app_wide.diffFromPrevious!.length).toBeGreaterThan(40);
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
