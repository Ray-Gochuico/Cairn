import { describe, it, expect } from 'vitest';
import {
  getHiddenCards,
} from '@/lib/calculator-visibility';

// The Node 25 localStorage polyfill is installed globally by tests/setup.ts.

describe('getHiddenCards', () => {
  it('returns empty array when nothing stored', () => {
    expect(getHiddenCards()).toEqual([]);
  });

  it('returns empty array on malformed JSON', () => {
    localStorage.setItem('calculator-hidden-cards', 'not-json');
    expect(getHiddenCards()).toEqual([]);
  });

  it('returns empty array when localStorage value is JSON object (not array)', () => {
    localStorage.setItem('calculator-hidden-cards', '{}');
    expect(getHiddenCards()).toEqual([]);
  });

  it('filters out non-string entries from a mixed array', () => {
    localStorage.setItem('calculator-hidden-cards', '[1, "valid", null]');
    expect(getHiddenCards()).toEqual(['valid']);
  });

  // LEGACY_ID_MIGRATIONS: fire → financial-independence
  it('migrates legacy "fire" id to "financial-independence"', () => {
    localStorage.setItem('calculator-hidden-cards', '["fire"]');
    expect(getHiddenCards()).toEqual(['financial-independence']);
  });

  it('passes through already-current "financial-independence" id unchanged', () => {
    localStorage.setItem('calculator-hidden-cards', '["financial-independence"]');
    expect(getHiddenCards()).toEqual(['financial-independence']);
  });

  it('leaves unrelated ids untouched', () => {
    localStorage.setItem('calculator-hidden-cards', '["net-worth","commission"]');
    expect(getHiddenCards()).toEqual(['net-worth', 'commission']);
  });

  it('de-dupes when both legacy and current id are present', () => {
    localStorage.setItem('calculator-hidden-cards', '["fire","financial-independence"]');
    expect(getHiddenCards()).toEqual(['financial-independence']);
  });
});

