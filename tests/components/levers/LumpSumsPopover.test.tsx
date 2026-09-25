import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import LumpSumsPopover from '@/components/whatif/levers/LumpSumsPopover';
import { useScenariosStore } from '@/stores/scenarios-store';
import { emptyLeverPayload } from '@/lib/scenarios';
import type { Scenario } from '@/types/scenario';

function resetStore() {
  useScenariosStore.setState({
    scenarios: [{
      id: 1, name: 'Baseline', isBaseline: true, color: '#4f86f7', lineStyle: 'solid',
      visible: true, isActive: true, sortOrder: 0, leverPayload: emptyLeverPayload(),
      createdAt: 't', updatedAt: 't',
    } as Scenario],
    isLoading: false, error: null,
    horizonMonths: 360,
    inflation: 0.025, defaultReturnRate: 0.07,
    updateLever: vi.fn().mockResolvedValue(undefined) as any,
  });
}

describe('LumpSumsPopover', () => {
  beforeEach(() => { resetStore(); });

  it('renders an empty state initially', () => {
    render(<MemoryRouter><LumpSumsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.getByText(/no lump-sum events yet/i)).toBeInTheDocument();
  });

  it('clicking + Add appends a row with default values', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><LumpSumsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /add event/i }));
    expect(screen.getAllByLabelText(/when/i)).toHaveLength(1);
    expect(screen.getAllByLabelText(/amount/i)).toHaveLength(1);
  });

  it('Apply with one row sends a lumpSums slice through updateLever', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><LumpSumsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /add event/i }));
    await user.clear(screen.getByLabelText(/when/i));
    await user.type(screen.getByLabelText(/when/i), '2030-06-01');
    await user.clear(screen.getByLabelText(/amount/i));
    await user.type(screen.getByLabelText(/amount/i), '25000');
    await user.click(screen.getByRole('button', { name: /apply/i }));
    const updateLever = (useScenariosStore.getState() as any).updateLever as ReturnType<typeof vi.fn>;
    expect(updateLever).toHaveBeenCalledWith(1, expect.objectContaining({
      lumpSums: [expect.objectContaining({ when: '2030-06-01', amount: 25000 })],
    }));
  });

  it('Remove deletes the row', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><LumpSumsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /add event/i }));
    await user.click(screen.getByRole('button', { name: /remove row 1/i }));
    expect(screen.queryByLabelText(/when/i)).not.toBeInTheDocument();
  });

  it('negative amount keeps the sign through Apply', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><LumpSumsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /add event/i }));
    await user.clear(screen.getByLabelText(/when/i));
    await user.type(screen.getByLabelText(/when/i), '2030-06-01');
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '-8000' } });
    await user.click(screen.getByRole('button', { name: /apply/i }));
    const updateLever = (useScenariosStore.getState() as any).updateLever as ReturnType<typeof vi.fn>;
    expect(updateLever).toHaveBeenCalledWith(1, expect.objectContaining({
      lumpSums: [expect.objectContaining({ amount: -8000 })],
    }));
  });
});

// v1.7.0 R4 smoke regression: a new row's When defaulted to the UTC day. The
// engine fires a lump sum in `when.slice(0, 7)`'s month against a projection
// that starts in the LOCAL month, so on a month's last local evening west of
// UTC the default landed a month late, and on a local 1st east of UTC it
// landed in the month BEFORE the projection starts. It is now the local day.
describe('LumpSumsPopover — a new row\'s When is the LOCAL day', () => {
  const ORIGINAL_TZ = process.env.TZ;
  beforeEach(() => {
    resetStore();
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  async function addRowWhen(): Promise<string> {
    const user = userEvent.setup();
    render(<MemoryRouter><LumpSumsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /add event/i }));
    return (screen.getByLabelText('When') as HTMLInputElement).value;
  }

  it('New York, 23:33 EDT on Sep 30 (03:33 UTC Oct 1): September 30', async () => {
    process.env.TZ = 'America/New_York';
    vi.setSystemTime(new Date('2026-10-01T03:33:00Z'));
    expect(await addRowWhen()).toBe('2026-09-30');
  });

  it('Pacific/Auckland, 10:00 NZDT on Oct 1 (21:00 UTC Sep 30): October 1', async () => {
    process.env.TZ = 'Pacific/Auckland';
    vi.setSystemTime(new Date('2026-09-30T21:00:00Z'));
    expect(await addRowWhen()).toBe('2026-10-01');
  });
});
