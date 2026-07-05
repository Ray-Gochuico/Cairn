import { describe, it, expect, vi } from 'vitest';
import { createDedupedLoad, createDedupedLoadPartial } from '@/stores/create-entity-store';

interface FakeState {
  items: number[];
  isLoading: boolean;
  error: string | null;
}

function harness(fetchImpl: () => Promise<number[]>) {
  const state: FakeState = { items: [], isLoading: false, error: null };
  const set = (partial: Partial<FakeState>) => Object.assign(state, partial);
  const fetchData = vi.fn(fetchImpl);
  const load = createDedupedLoad<FakeState, 'items'>(set, 'items', fetchData);
  return { state, load, fetchData };
}

describe('createDedupedLoad', () => {
  it('loads data into the keyed slot and clears isLoading', async () => {
    const { state, load } = harness(async () => [1, 2, 3]);
    await load();
    expect(state.items).toEqual([1, 2, 3]);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('concurrent calls share one fetch; the same promise is returned', async () => {
    let release!: (v: number[]) => void;
    const gate = new Promise<number[]>((res) => (release = res));
    const { load, fetchData } = harness(() => gate);
    const p1 = load();
    const p2 = load();
    expect(p1).toBe(p2); // literally the same in-flight promise
    release([7]);
    await Promise.all([p1, p2]);
    expect(fetchData).toHaveBeenCalledTimes(1);
  });

  it('a call after settle re-fetches (mutation reloads stay live)', async () => {
    const { load, fetchData } = harness(async () => []);
    await load();
    await load();
    expect(fetchData).toHaveBeenCalledTimes(2);
  });

  it('swallows fetch errors into state.error (load never rethrows) and still clears the guard', async () => {
    let calls = 0;
    const { state, load } = harness(async () => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
      return [42];
    });
    await expect(load()).resolves.toBeUndefined();
    expect(state.error).toBe('boom');
    expect(state.isLoading).toBe(false);
    // Guard cleared on the error path too — next load runs fresh and recovers.
    await load();
    expect(state.items).toEqual([42]);
    expect(state.error).toBeNull();
  });

  it('non-Error throw maps to the conventional fallback message', async () => {
    const { state, load } = harness(async () => {
      throw 'string reject';
    });
    await load();
    expect(state.error).toBe('Failed to load');
  });
});

describe('createDedupedLoadPartial (multi-key loads, e.g. learning-state)', () => {
  interface MultiState { a: number[]; b: string | null; isLoading: boolean; error: string | null }

  function harnessP() {
    let state: Partial<MultiState> = {};
    const set = vi.fn((partial: Partial<MultiState>) => { state = { ...state, ...partial }; });
    return { set, state: () => state };
  }

  it('collapses concurrent calls to one fetch and spreads the partial on success', async () => {
    const h = harnessP();
    const fetchPartial = vi.fn(async () => ({ a: [1, 2], b: 'x' }) as Partial<MultiState>);
    const load = createDedupedLoadPartial<MultiState>(h.set, fetchPartial);
    await Promise.all([load(), load()]);
    expect(fetchPartial).toHaveBeenCalledTimes(1);
    expect(h.state()).toMatchObject({ a: [1, 2], b: 'x', isLoading: false });
  });

  it('re-fetches after settle', async () => {
    const h = harnessP();
    const fetchPartial = vi.fn(async () => ({}) as Partial<MultiState>);
    const load = createDedupedLoadPartial<MultiState>(h.set, fetchPartial);
    await load();
    await load();
    expect(fetchPartial).toHaveBeenCalledTimes(2);
  });

  it('swallows errors into state.error and clears the guard', async () => {
    const h = harnessP();
    const load = createDedupedLoadPartial<MultiState>(h.set, async () => {
      throw new Error('boom');
    });
    await load();
    expect(h.state()).toMatchObject({ isLoading: false, error: 'boom' });
    await load(); // guard cleared — a second call runs (and fails) again
    expect(h.state().error).toBe('boom');
  });

  it('non-Error throws fall back to the shared message', async () => {
    const h = harnessP();
    const load = createDedupedLoadPartial<MultiState>(h.set, async () => {
      throw 'string-throw';
    });
    await load();
    expect(h.state().error).toBe('Failed to load');
  });
});
