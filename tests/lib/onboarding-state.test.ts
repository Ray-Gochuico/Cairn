import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ONBOARDING_TAILOR_DONE_KEY,
  ONBOARDING_TOUR_DONE_KEY,
  isTailorDone,
  markTailorDone,
  isTourDone,
  markTourDone,
} from '@/lib/onboarding-state';

describe('onboarding-state markers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('isTailorDone / isTourDone are false before either marker is set', () => {
    expect(isTailorDone()).toBe(false);
    expect(isTourDone()).toBe(false);
  });

  it('markTailorDone persists a marker that isTailorDone reads back (tour untouched)', () => {
    markTailorDone();
    expect(localStorage.getItem(ONBOARDING_TAILOR_DONE_KEY)).not.toBeNull();
    expect(isTailorDone()).toBe(true);
    // Independent keys: marking tailor done must not imply tour done.
    expect(isTourDone()).toBe(false);
  });

  it('markTourDone persists a marker that isTourDone reads back (tailor untouched)', () => {
    markTourDone();
    expect(localStorage.getItem(ONBOARDING_TOUR_DONE_KEY)).not.toBeNull();
    expect(isTourDone()).toBe(true);
    expect(isTailorDone()).toBe(false);
  });

  it('the two keys are the locked v1 names', () => {
    expect(ONBOARDING_TAILOR_DONE_KEY).toBe('onboarding.tailor.done.v1');
    expect(ONBOARDING_TOUR_DONE_KEY).toBe('onboarding.tour.done.v1');
  });
});

describe('onboarding-state markers — fail-open (storage unavailable)', () => {
  let original: Storage;

  beforeEach(() => {
    original = globalThis.localStorage;
    const throwing = {
      getItem() {
        throw new Error('storage disabled');
      },
      setItem() {
        throw new Error('storage disabled');
      },
      removeItem() {
        throw new Error('storage disabled');
      },
      clear() {
        throw new Error('storage disabled');
      },
      key() {
        throw new Error('storage disabled');
      },
      get length(): number {
        throw new Error('storage disabled');
      },
    } as unknown as Storage;
    Object.defineProperty(globalThis, 'localStorage', {
      value: throwing,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: original,
      writable: true,
      configurable: true,
    });
  });

  it('isTailorDone / isTourDone fail OPEN to false when reads throw', () => {
    expect(isTailorDone()).toBe(false);
    expect(isTourDone()).toBe(false);
  });

  it('markTailorDone / markTourDone swallow write errors (no throw)', () => {
    expect(() => markTailorDone()).not.toThrow();
    expect(() => markTourDone()).not.toThrow();
  });
});
