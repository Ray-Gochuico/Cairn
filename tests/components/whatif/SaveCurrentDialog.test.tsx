import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SaveCurrentDialog } from '@/components/whatif/SaveCurrentDialog';

const saveCurrentMock = vi.fn().mockResolvedValue(7);

vi.mock('@/stores/scenarios-store', () => ({
  useScenariosStore: () => ({ saveCurrentAsScenario: saveCurrentMock }),
}));

function setup(defaultName = 'Scenario 2') {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(
    <MemoryRouter>
      <SaveCurrentDialog defaultName={defaultName} onClose={onClose} onSaved={onSaved} />
    </MemoryRouter>,
  );
  return { user: userEvent.setup(), onClose, onSaved };
}

describe('SaveCurrentDialog', () => {
  beforeEach(() => {
    saveCurrentMock.mockClear();
  });

  it('seeds the input with the suggested default name', () => {
    setup('Scenario 4');
    expect((screen.getByLabelText('Scenario name') as HTMLInputElement).value).toBe('Scenario 4');
  });

  it('calls saveCurrentAsScenario with the trimmed name, then onSaved with the new id', async () => {
    const { user, onSaved, onClose } = setup();
    const input = screen.getByLabelText('Scenario name');
    await user.clear(input);
    await user.type(input, '  Aggressive payoff  ');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(saveCurrentMock).toHaveBeenCalledWith('Aggressive payoff');
    expect(onSaved).toHaveBeenCalledWith(7);
    expect(onClose).toHaveBeenCalled();
  });

  it('blocks Save when the name trims to empty', async () => {
    const { user } = setup();
    await user.clear(screen.getByLabelText('Scenario name'));
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('Cancel does not call saveCurrentAsScenario', async () => {
    const { user, onClose } = setup();
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(saveCurrentMock).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
