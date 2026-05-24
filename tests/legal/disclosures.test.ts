import { describe, it, expect } from 'vitest';
import { DISCLOSURES } from '@/legal/disclosures';

describe('DISCLOSURES', () => {
  it('defines an app_wide disclosure with a version + body + checkbox label', () => {
    expect(DISCLOSURES.app_wide.version).toBe('1.0');
    expect(DISCLOSURES.app_wide.body.length).toBeGreaterThan(200);
    expect(DISCLOSURES.app_wide.acceptanceCheckboxLabel).toMatch(/at my own risk/i);
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
