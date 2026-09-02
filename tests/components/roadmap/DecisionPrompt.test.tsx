import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DecisionPrompt, hasDecisionPrompt, anyDecisionPrompt } from '@/components/roadmap/DecisionPrompt';

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

/**
 * ONE PLACE PER THING (smoke defect D2, 2026-09-02). /what-if's G9 row claims
 * "The roadmap has questions you haven't answered" and links to /roadmap, so
 * the two surfaces must agree on what counts. The Roadmap's own test is this
 * one: NodeRow renders a DecisionPrompt exactly when the rule engine attached
 * a question to the node's result. `status: 'unanswered'` alone is BROADER —
 * rows like s1_employer_match report 'unanswered' with a CTA to Accounts and
 * no question at all, and G9 was sending users to a page with nothing on it
 * to answer.
 */
describe('hasDecisionPrompt / anyDecisionPrompt (the Roadmap page predicate)', () => {
  const q = {
    prompt: 'Have you written an IPS?',
    answerType: 'yes-no' as const,
    onAnswer: async () => {},
  };

  it('is true exactly when the rule attached a question — status is not consulted', () => {
    expect(hasDecisionPrompt({ status: 'unanswered', question: q })).toBe(true);
    expect(hasDecisionPrompt({ status: 'unanswered' })).toBe(false);
    // A CTA is a pointer somewhere ELSE; it is not something to answer here.
    expect(hasDecisionPrompt({
      status: 'unanswered',
      evidence: 'Mark which retirement accounts (if any) come with an employer match.',
      cta: { label: 'Open Accounts →', href: '/investments?manage=accounts' },
    })).toBe(false);
    expect(hasDecisionPrompt({ status: 'done' })).toBe(false);
    expect(hasDecisionPrompt({ status: 'active' })).toBe(false);
    // applyOverrides (evaluate.ts) rewrites only `status` and keeps the rest of
    // the auto result, so a node the user pinned to done can still carry its
    // question — and NodeRow still renders that prompt. Conjoining a status
    // check here would put G9 back out of step with the page.
    expect(hasDecisionPrompt({
      status: 'done', question: q, autoResult: { status: 'unanswered', question: q },
    })).toBe(true);
  });

  it('anyDecisionPrompt scans a results collection and stays false for CTA-only rows', () => {
    expect(anyDecisionPrompt([])).toBe(false);
    expect(anyDecisionPrompt([{ status: 'unanswered' }, { status: 'active' }])).toBe(false);
    expect(anyDecisionPrompt([{ status: 'done' }, { status: 'unanswered', question: q }])).toBe(true);
    // Accepts the Map#values() iterator evaluate() hands back.
    const results = new Map([['n1', { status: 'unanswered' as const, question: q }]]);
    expect(anyDecisionPrompt(results.values())).toBe(true);
  });
});
