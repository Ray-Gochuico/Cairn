import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DecisionPrompt } from '@/components/roadmap/DecisionPrompt';

describe('DecisionPrompt', () => {
  it('renders Yes / No buttons for yes-no questions', () => {
    render(
      <DecisionPrompt
        question={{
          prompt: 'Have you written an IPS?',
          answerType: 'yes-no',
          onAnswer: vi.fn(),
        }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Yes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No' })).toBeInTheDocument();
  });

  it('renders supplied enum options when answerType is enum', () => {
    render(
      <DecisionPrompt
        question={{
          prompt: 'How stable is your income?',
          answerType: 'enum',
          options: [
            { value: 'stable', label: 'Stable' },
            { value: 'unstable', label: 'Unstable' },
          ],
          onAnswer: vi.fn(),
        }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Stable' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unstable' })).toBeInTheDocument();
  });

  it('calls onAnswer with the clicked option value', async () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    render(
      <DecisionPrompt
        question={{
          prompt: 'Stable?',
          answerType: 'yes-no',
          onAnswer,
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    await waitFor(() => {
      expect(onAnswer).toHaveBeenCalledWith('yes');
    });
  });

  it('surfaces an inline error when onAnswer rejects', async () => {
    const onAnswer = vi.fn().mockRejectedValue(new Error('database busy'));
    render(
      <DecisionPrompt
        question={{
          prompt: 'Try me',
          answerType: 'yes-no',
          onAnswer,
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/database busy/i);
    });
  });

  it('disables buttons while a write is in-flight to prevent double-submits', async () => {
    let resolveOuter: () => void = () => {};
    const onAnswer = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveOuter = resolve;
        }),
    );
    render(
      <DecisionPrompt
        question={{
          prompt: 'Stable?',
          answerType: 'yes-no',
          onAnswer,
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(screen.getByRole('button', { name: 'Yes' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'No' })).toBeDisabled();
    resolveOuter();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Yes' })).not.toBeDisabled();
    });
  });
});
