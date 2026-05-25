import { describe, it, expect, beforeEach, vi } from 'vitest';
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
    horizonMonths: 360, dollarMode: 'nominal',
    inflation: 0.025, defaultReturnRate: 0.07,
    projectionCache: new Map(),
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
