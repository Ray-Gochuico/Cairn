import { describe, it, expect, vi, afterEach } from 'vitest';
import { setDatabase } from '@/db/db';
import { DisclosureAcceptancesRepo } from '@/domain/disclosure-acceptances';
import { useAcceptancesStore } from '@/stores/disclosure-acceptances-store';

// The store's load() projects disclosure_acceptances for the boot gate. These
// tests pin the resilience contract: the read is BOUNDED so a hung/orphaned
// query (e.g. a `tauri dev` hot-reload orphaning the SQL IPC callback mid-boot)
// converts to a fail-closed 'error' instead of freezing the gate on "Loading…".
// The DB is a dummy — latestVersionsByDocument is mocked, so the repo never
// touches it; this isolates the store's timeout/branch logic.

describe('useAcceptancesStore.load resilience', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    useAcceptancesStore.setState({
      acceptedVersions: {},
      status: 'loading',
      isLoading: false,
      error: null,
    });
  });

  it('resolves to ready with the projected versions on a normal read', async () => {
    setDatabase({} as never);
    vi.spyOn(DisclosureAcceptancesRepo.prototype, 'latestVersionsByDocument').mockResolvedValue({
      app_wide: '1.0',
      learning: '1.0',
    });

    await useAcceptancesStore.getState().load();

    const s = useAcceptancesStore.getState();
    expect(s.status).toBe('ready');
    expect(s.acceptedVersions.app_wide).toBe('1.0');
    expect(s.acceptedVersions.learning).toBe('1.0');
  });

  it('fails CLOSED (status "error") when the read hangs past the timeout — never an eternal "loading"', async () => {
    vi.useFakeTimers();
    setDatabase({} as never);
    // Simulate an orphaned IPC callback: the read promise never settles.
    vi.spyOn(DisclosureAcceptancesRepo.prototype, 'latestVersionsByDocument').mockReturnValue(
      new Promise(() => {}),
    );

    const pending = useAcceptancesStore.getState().load();
    // Before the timeout fires, the store is still loading (not stuck-resolved).
    expect(useAcceptancesStore.getState().status).toBe('loading');

    // Advance past the 8s bound — the timeout rejects, load() catches → error.
    await vi.advanceTimersByTimeAsync(8001);
    await pending;

    expect(useAcceptancesStore.getState().status).toBe('error');
    expect(useAcceptancesStore.getState().isLoading).toBe(false);
  });

  it('fails closed when the read rejects (DB error)', async () => {
    setDatabase({} as never);
    vi.spyOn(DisclosureAcceptancesRepo.prototype, 'latestVersionsByDocument').mockRejectedValue(
      new Error('boom'),
    );

    await useAcceptancesStore.getState().load();

    expect(useAcceptancesStore.getState().status).toBe('error');
  });
});
