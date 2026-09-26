import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_SCHEMA_VERSION } from '@/db/migrations';
import { DISTINCT_RELEASED_SCHEMAS, LAST_RELEASED_SCHEMA, RELEASED_SCHEMAS } from './released-schemas';
import { parseReleasedSchemas, sortReleaseTags } from '../../scripts/released-schema-guard.mjs';

describe('released schemas (v1.7.1 U3; re-derived from the tags — CR-U3-3)', () => {
  it('rows are final release tags in version order, and a later release never ships a lower schema', () => {
    const tags = Object.keys(RELEASED_SCHEMAS);
    expect(sortReleaseTags(tags)).toEqual(tags);
    const schemas = Object.values(RELEASED_SCHEMAS);
    expect(schemas.every((s, i) => i === 0 || s >= schemas[i - 1])).toBe(true);
    expect(schemas.every((s) => s <= MAX_SCHEMA_VERSION)).toBe(true);
  });

  // Plan review R-8: structural, so the first schema-bumping release (v1.8.0 adds
  // 'v1.8.0': 56) keeps this green; the v1.7.0-era prefix stays frozen exactly.
  it('the distinct released schemas start 47, 50, 51, 52, 53, 55 (frozen at v1.7.0) and strictly ascend; the last is the newest row', () => {
    expect(DISTINCT_RELEASED_SCHEMAS.slice(0, 6)).toEqual([47, 50, 51, 52, 53, 55]);
    expect(DISTINCT_RELEASED_SCHEMAS.every((s, i) => i === 0 || s > DISTINCT_RELEASED_SCHEMAS[i - 1])).toBe(true);
    const rows = Object.values(RELEASED_SCHEMAS);
    expect(LAST_RELEASED_SCHEMA).toBe(rows[rows.length - 1]);
    expect(LAST_RELEASED_SCHEMA).toBe(DISTINCT_RELEASED_SCHEMAS[DISTINCT_RELEASED_SCHEMAS.length - 1]);
  });

  // Code review CR-U3-9 (R-8, per tag): a mis-edited older row can leave the
  // distinct set unchanged ('v1.1.1': 51), so every v1.7.0-era row is frozen.
  it('the v1.7.0-era rows are frozen exactly, tag by tag (a later release only appends)', () => {
    expect(Object.entries(RELEASED_SCHEMAS).slice(0, 11)).toEqual([
      ['v1.0.0', 47],
      ['v1.0.1', 47],
      ['v1.0.2', 47],
      ['v1.1.0', 50],
      ['v1.1.1', 50],
      ['v1.2.0', 51],
      ['v1.3.0', 52],
      ['v1.4.0', 53],
      ['v1.5.0', 55],
      ['v1.6.0', 55],
      ['v1.7.0', 55],
    ]);
  });

  it('the file reads the same as text (the release guard parses it that way) as it does as a module', () => {
    const text = readFileSync(path.join(__dirname, 'released-schemas.ts'), 'utf8');
    expect(parseReleasedSchemas(text)).toEqual({ ...RELEASED_SCHEMAS });
  });
});
