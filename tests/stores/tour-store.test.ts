import { describe, it, expect, beforeEach } from 'vitest';
import { useTourStore } from '@/stores/tour-store';

describe('useTourStore', () => {
  beforeEach(() => {
    useTourStore.setState({ active: false, stepIndex: 0, mode: 'core' });
  });

  it('starts inactive at step 0 in core mode', () => {
    const s = useTourStore.getState();
    expect(s.active).toBe(false);
    expect(s.stepIndex).toBe(0);
    expect(s.mode).toBe('core');
  });

  it('start() activates at step 0 / core mode', () => {
    useTourStore.getState().start();
    const s = useTourStore.getState();
    expect(s.active).toBe(true);
    expect(s.stepIndex).toBe(0);
    expect(s.mode).toBe('core');
  });

  it('start() is idempotent — a second call mid-tour does not reset progress', () => {
    useTourStore.getState().start();
    useTourStore.getState().next();
    useTourStore.getState().continueAll();
    expect(useTourStore.getState().stepIndex).toBe(1);
    // StrictMode double-invoke / re-entry must NOT rewind the user.
    useTourStore.getState().start();
    const s = useTourStore.getState();
    expect(s.active).toBe(true);
    expect(s.stepIndex).toBe(1);
    expect(s.mode).toBe('all');
  });

  it('next() advances and back() retreats, clamping at 0', () => {
    useTourStore.getState().start();
    useTourStore.getState().next();
    useTourStore.getState().next();
    expect(useTourStore.getState().stepIndex).toBe(2);
    useTourStore.getState().back();
    expect(useTourStore.getState().stepIndex).toBe(1);
    useTourStore.getState().back();
    useTourStore.getState().back();
    expect(useTourStore.getState().stepIndex).toBe(0); // clamped, never negative
  });

  it('continueAll() switches mode to all without moving stepIndex', () => {
    useTourStore.getState().start();
    useTourStore.getState().next();
    useTourStore.getState().continueAll();
    const s = useTourStore.getState();
    expect(s.mode).toBe('all');
    expect(s.stepIndex).toBe(1);
  });

  it('end() deactivates and resets to step 0 / core mode', () => {
    useTourStore.getState().start();
    useTourStore.getState().next();
    useTourStore.getState().continueAll();
    useTourStore.getState().end();
    const s = useTourStore.getState();
    expect(s.active).toBe(false);
    expect(s.stepIndex).toBe(0);
    expect(s.mode).toBe('core');
  });
});
