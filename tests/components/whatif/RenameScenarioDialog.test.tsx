import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { RenameScenarioDialog } from '@/components/whatif/RenameScenarioDialog';

const renameMock = vi.fn().mockResolvedValue(undefined);

vi.mock('@/stores/scenarios-store', () => ({
  useScenariosStore: () => ({ rename: renameMock }),
}));

function setup(initialName = 'Pay-off plan') {
  const onClose = vi.fn();
  render(
    <MemoryRouter>
      <RenameScenarioDialog scenarioId={42} initialName={initialName} onClose={onClose} />
    </MemoryRouter>,
  );
  return { user: userEvent.setup(), onClose };
}

describe('RenameScenarioDialog', () => {
  beforeEach(() => {
    renameMock.mockClear();
  });

  it('seeds the input with the initial name', () => {
    setup('Original');
    const input = screen.getByLabelText('Scenario name') as HTMLInputElement;
    expect(input.value).toBe('Original');
  });

  it('calls scenarios-store.rename with the trimmed name and closes', async () => {
    const { user, onClose } = setup();
    const input = screen.getByLabelText('Scenario name');
    await user.clear(input);
    await user.type(input, '  Aggressive payoff  ');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(renameMock).toHaveBeenCalledWith(42, 'Aggressive payoff');
    expect(onClose).toHaveBeenCalled();
  });

  it('disables Save when the name is empty after trimming', async () => {
    const { user } = setup('Original');
    const input = screen.getByLabelText('Scenario name');
    await user.clear(input);
    await user.type(input, '   ');
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('calls onClose on Cancel without calling rename', async () => {
    const { user, onClose } = setup();
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(renameMock).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
