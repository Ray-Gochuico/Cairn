import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { DISCLOSURES } from '@/legal/disclosures';
import { DISCLOSURE_VERSIONS } from './disclosure-versions';

// A-7(7) (v1.7.1): the contract of the one literal version table.
const SOURCE = readFileSync(path.join(__dirname, 'disclosure-versions.ts'), 'utf8');
type Id = keyof typeof DISCLOSURES;

describe('tests/helpers/disclosure-versions — the one literal version table (A-7(7))', () => {
  it('carries exactly the five registry ids', () => {
    expect(Object.keys(DISCLOSURE_VERSIONS).sort()).toEqual(Object.keys(DISCLOSURES).sort());
    expect(Object.keys(DISCLOSURE_VERSIONS)).toHaveLength(5); // the name's "five", pinned (D7 review)
  });

  it('every value is an x.y version string', () => {
    for (const v of Object.values(DISCLOSURE_VERSIONS)) expect(v).toMatch(/^\d+\.\d+$/);
  });

  it('stays literal: the file imports nothing, and every value is typed out as a quoted string', () => {
    expect(SOURCE).not.toMatch(/^\s*import\b/m);
    expect(SOURCE).not.toMatch(/\brequire\(/);
    for (const [id, v] of Object.entries(DISCLOSURE_VERSIONS)) {
      expect(SOURCE, id).toContain(`  ${id}: '${v}',\n`);
    }
  });

  it('agrees with the registry (a bump moves the registry, its own pins in tests/legal/disclosures.test.ts, and this table together)', () => {
    for (const id of Object.keys(DISCLOSURES) as Id[]) {
      expect(DISCLOSURE_VERSIONS[id], id).toBe(DISCLOSURES[id].version);
    }
  });
});
