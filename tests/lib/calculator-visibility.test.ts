import { describe, it, expect, beforeEach } from 'vitest';
import {
  getHiddenCards,
  hideCard,
  showCard,
  isHidden,
} from '@/lib/calculator-visibility';

// Node 25 ships an experimental built-in `localStorage` global as an empty
// stub object that shadows jsdom's Storage. Install a real in-memory Storage
// before each test so the helper sees a Web-API-compatible object.
function createMemoryStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    get length() {
      return Object.keys(store).length;
    },
    clear() {
      store = {};
    },
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    key(index: number) {
      return Object.keys(store)[index] ?? null;
    },
    removeItem(key: string) {
      delete store[key];
    },
    setItem(key: string, value: string) {
      store[key] = String(value);
    },
  };
}

beforeEach(() => {
  const fresh = createMemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    value: fresh,
    writable: true,
    configurable: true,
  });
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', {
      value: fresh,
      writable: true,
      configurable: true,
    });
  }
});

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
});

describe('hideCard / showCard', () => {
  it('hideCard adds id to the set', () => {
    hideCard('bonus-tax');
    expect(getHiddenCards()).toContain('bonus-tax');
  });

  it('hideCard is idempotent', () => {
    hideCard('bonus-tax');
    hideCard('bonus-tax');
    expect(getHiddenCards().filter((id) => id === 'bonus-tax')).toHaveLength(1);
  });

  it('showCard removes id from the set', () => {
    hideCard('bonus-tax');
    hideCard('commission');
    showCard('bonus-tax');
    expect(getHiddenCards()).not.toContain('bonus-tax');
    expect(getHiddenCards()).toContain('commission');
  });

  it('showCard is no-op when id is not in hidden set', () => {
    hideCard('commission');
    expect(() => showCard('never-hidden')).not.toThrow();
    expect(getHiddenCards()).toEqual(['commission']);
  });
});

describe('isHidden', () => {
  it('returns true when card is in the hidden set (regardless of autoVisibility)', () => {
    hideCard('commission');
    expect(isHidden('commission', true)).toBe(true);
  });

  it('returns true when autoVisibility is false (even if not in hidden set)', () => {
    expect(isHidden('overtime', false)).toBe(true);
  });

  it('returns false when not hidden and autoVisibility is true', () => {
    expect(isHidden('paycheck', true)).toBe(false);
  });
});
