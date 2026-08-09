import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import GateQuestion from '@/pages/setup/flow/GateQuestion';

const baseProps = {
  idPrefix: 'gate-loans',
  question: 'Do you have any loans — mortgage, car, student, credit cards?',
  consequence: 'Nothing is recorded — loans can be added any time on the Loans page.',
  entityCount: 0,
  nounSingular: 'loan',
  nounPlural: 'loans',
  storedStatus: 'pending' as const,
  answer: null,
  literalAnswer: null,
  onAnswer: vi.fn(),
};

describe('GateQuestion (generic gate UI)', () => {
  it('renders the question with Yes/No radios, nothing checked by default', () => {
    render(<GateQuestion {...baseProps} />);
    expect(
      screen.getByText('Do you have any loans — mortgage, car, student, credit cards?'),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Yes' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'No' })).not.toBeChecked();
  });

  it('No shows the consequence line', () => {
    render(<GateQuestion {...baseProps} answer="no" />);
    expect(
      screen.getByText('Nothing is recorded — loans can be added any time on the Loans page.'),
    ).toBeInTheDocument();
  });

  it('entityCount > 0 forces the control to yes; skipped stored status shows the CW-33 note', () => {
    render(
      <GateQuestion {...baseProps} entityCount={2} storedStatus="skipped" answer={null} />,
    );
    expect(screen.getByRole('radio', { name: 'Yes' })).toBeChecked();
    expect(
      screen.getByText('Recorded as skipped earlier — 2 loans exist.'),
    ).toBeInTheDocument();
  });

  it('singular CW-33 register: 1 loan exists.', () => {
    render(
      <GateQuestion {...baseProps} entityCount={1} storedStatus="skipped" answer={null} />,
    );
    expect(
      screen.getByText('Recorded as skipped earlier — 1 loan exists.'),
    ).toBeInTheDocument();
  });

  it('M2: a literal "no" answer + 0 entities shows the changed-your-mind hint (CW-34)', () => {
    render(
      <GateQuestion
        {...baseProps}
        entityCount={0}
        storedStatus="skipped"
        literalAnswer="no"
        answer="no"
      />,
    );
    expect(
      screen.getByText('You said no loans earlier — changed your mind?'),
    ).toBeInTheDocument();
  });

  it('M2: a DERIVED skipped status without a literal answer renders no hint', () => {
    render(<GateQuestion {...baseProps} entityCount={0} storedStatus="skipped" />);
    expect(screen.queryByText(/changed your mind/)).toBeNull();
    expect(screen.queryByText(/You said/)).toBeNull();
  });

  it('changedYourMindText overrides the CW-34 template (import gate variant)', () => {
    render(
      <GateQuestion
        {...baseProps}
        entityCount={0}
        storedStatus="skipped"
        literalAnswer="no"
        answer="no"
        changedYourMindText="You said not now earlier — changed your mind?"
      />,
    );
    expect(
      screen.getByText('You said not now earlier — changed your mind?'),
    ).toBeInTheDocument();
  });

  it('M2: CW-35 renders ONLY for a literal "yes" answer with 0 entities', () => {
    render(
      <GateQuestion
        {...baseProps}
        entityCount={0}
        storedStatus="completed"
        literalAnswer="yes"
        answer="yes"
      />,
    );
    expect(
      screen.getByText('You said yes earlier — nothing has been added yet.'),
    ).toBeInTheDocument();
  });

  it('M2: a DERIVED completed status without a literal answer renders no CW-35', () => {
    // A form-view Section advance derives gate statuses — the user never
    // "said yes"; fabricating the attribution was the review's M2.
    render(<GateQuestion {...baseProps} entityCount={0} storedStatus="completed" />);
    expect(screen.queryByText('You said yes earlier — nothing has been added yet.')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Yes' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'No' })).not.toBeChecked();
  });

  it('m2: showRequiredError renders the required message wired to the radiogroup', () => {
    render(<GateQuestion {...baseProps} showRequiredError />);
    expect(screen.getByText('An answer is required.')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup')).toHaveAttribute(
      'aria-describedby',
      'gate-loans-required-error',
    );
  });

  it('children render only on yes', () => {
    const { rerender } = render(
      <GateQuestion {...baseProps} answer={null}>
        <div data-testid="inline-cards" />
      </GateQuestion>,
    );
    expect(screen.queryByTestId('inline-cards')).toBeNull();
    rerender(
      <GateQuestion {...baseProps} answer="no">
        <div data-testid="inline-cards" />
      </GateQuestion>,
    );
    expect(screen.queryByTestId('inline-cards')).toBeNull();
    rerender(
      <GateQuestion {...baseProps} answer="yes">
        <div data-testid="inline-cards" />
      </GateQuestion>,
    );
    expect(screen.getByTestId('inline-cards')).toBeInTheDocument();
  });
});
