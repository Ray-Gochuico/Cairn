import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImportPreviewModal } from '@/components/import/ImportPreviewModal';

vi.mock('@/lib/import/commit/property', () => ({
  commitPropertyImport: vi.fn().mockResolvedValue({ inserted: 1, updated: 0, skipped: 0 }),
}));
vi.mock('@/lib/import/commit/vehicle', () => ({
  commitVehicleImport: vi.fn().mockResolvedValue({ inserted: 1, updated: 0, skipped: 0 }),
}));
vi.mock('@/db/db', () => ({
  getDatabase: () => ({
    execute: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
    select: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

/**
 * v1.7.0 R4 smoke regression: a property / vehicle import whose value changes
 * mints an asset-value snapshot dated `todayIso`, and the modal handed the
 * commit the UTC day — tomorrow in the evening west of UTC. It now hands the
 * LOCAL day.
 */
const ctx = {
  accounts: [], persons: [], categories: [],
  properties: [{ id: 5, name: 'Main Residence' }],
  vehicles: [{ id: 9, name: 'Daily' }],
};

const ARMS = [
  { zone: 'America/New_York', instant: '2026-09-25T03:33:00Z', local: '2026-09-24', label: '23:33 EDT (03:33 UTC the next day)' },
  { zone: 'Pacific/Auckland', instant: '2026-09-24T21:00:00Z', local: '2026-09-25', label: '09:00 NZST (21:00 UTC the previous day)' },
] as const;

describe('ImportPreviewModal — property / vehicle commits carry the LOCAL day', () => {
  const ORIGINAL_TZ = process.env.TZ;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  it.each(ARMS)('property — $zone, $label: $local', async ({ zone, instant, local }) => {
    process.env.TZ = zone;
    vi.setSystemTime(new Date(instant));
    const onOpenChange = vi.fn();
    render(
      <ImportPreviewModal
        entity="property"
        parsed={{
          headers: ['name', 'type', 'current_estimated_value'],
          rows: [{ name: 'Lake house', type: 'PRIMARY_RESIDENCE', current_estimated_value: '500000' }],
          errors: [],
        }}
        ctx={ctx}
        open
        onOpenChange={onOpenChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^commit/i }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const { commitPropertyImport } = await import('@/lib/import/commit/property');
    expect(vi.mocked(commitPropertyImport).mock.calls[0][1]).toMatchObject({ todayIso: local });
  });

  it.each(ARMS)('vehicle — $zone, $label: $local', async ({ zone, instant, local }) => {
    process.env.TZ = zone;
    vi.setSystemTime(new Date(instant));
    const onOpenChange = vi.fn();
    render(
      <ImportPreviewModal
        entity="vehicle"
        parsed={{
          headers: ['name', 'current_estimated_value'],
          rows: [{ name: 'Wagon', current_estimated_value: '15000' }],
          errors: [],
        }}
        ctx={ctx}
        open
        onOpenChange={onOpenChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^commit/i }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const { commitVehicleImport } = await import('@/lib/import/commit/vehicle');
    expect(vi.mocked(commitVehicleImport).mock.calls[0][1]).toMatchObject({ todayIso: local });
  });
});
