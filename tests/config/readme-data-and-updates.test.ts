import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// v1.7.1 U1 (CR-U1-31, revised at code review U1-m21): the README's "Your data
// and updates" paragraph must agree with the in-app note after an update
// ("Cairn updated your data for this version."): INSTALLING an update never
// touches the data file; the app itself then updates the data, after keeping
// a copy. It sits under both install sections (Mac and Windows).
const README = readFileSync(resolve(__dirname, '../../README.md'), 'utf8');
const PARAGRAPH =
  '**Your data and updates:** installing an update replaces the program, never your data — the program and your database live in different places. When a new version changes how data is stored, Cairn first keeps a copy of your data, listed under **Settings → Data** as "Before update", and then updates your data the next time it opens.';

describe('README — your data and updates (CR-U1-31, U1-m21)', () => {
  it('carries the paragraph byte-exact under both install sections', () => {
    expect(README.split(PARAGRAPH).length - 1).toBe(2);
  });

  it('no longer says updating never touches your data (the app does update it, after a copy)', () => {
    expect(README).not.toMatch(/updating never touches your data/i);
  });

  it('sits above ## Privacy (whose block is byte-pinned elsewhere)', () => {
    expect(README.lastIndexOf(PARAGRAPH)).toBeLessThan(README.indexOf('## Privacy'));
  });
});
