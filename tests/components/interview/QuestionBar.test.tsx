import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuestionBar } from '@/components/interview/QuestionBar';
import { useAcceptancesStore } from '@/stores/disclosure-acceptances-store';
import { useInterviewBarStore } from '@/lib/interview/bar-store';
import { DISCLOSURES } from '@/legal/disclosures';
import { fixtureCtx } from '../../lib/interview/waterfall.test';

beforeEach(() => {
  sessionStorage.clear();
  useInterviewBarStore.setState({ amount: null, cadence: 'one-time', submitted: null });
  useAcceptancesStore.setState({
    acceptedVersions: { interview: DISCLOSURES.interview.version },
  } as never);
});

describe('QuestionBar', () => {
  it('renders the CI-1 sentence with typed controls only', () => {
    render(<QuestionBar ctx={fixtureCtx()} />);
    expect(screen.getByLabelText('Amount')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Cadence' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show me' })).toBeInTheDocument();
    // No free-text inputs: the only textbox is the MoneyInput.
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });

  it('validates the amount (CI-2) without submitting', () => {
    render(<QuestionBar ctx={fixtureCtx()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show me' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter an amount over $0 and at most $10,000,000.');
    expect(useInterviewBarStore.getState().submitted).toBeNull();
  });

  it('submits $10,000 one-time → three framework cards with the fixture split', () => {
    render(<QuestionBar ctx={fixtureCtx()} />);
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '10000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show me' }));
    expect(screen.getByTestId('framework-conservative')).toHaveTextContent('Emergency fund — to 6× expenses');
    expect(screen.getByTestId('framework-conservative')).toHaveTextContent('$6,000');
    expect(screen.getByTestId('framework-moderate')).toHaveTextContent('$500');
    expect(screen.getByTestId('framework-aggressive')).toHaveTextContent('$7,000');
    // CI-5 footer on every card:
    expect(screen.getAllByText('One mechanical framework applied to your numbers — not advice, not a recommendation.')).toHaveLength(3);
  });

  it('first submission behind the gate: unaccepted interview disclosure opens the modal; accept proceeds', () => {
    useAcceptancesStore.setState({ acceptedVersions: {} } as never);
    render(<QuestionBar ctx={fixtureCtx()} />);
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '10000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show me' }));
    // The id-generic DisclosureModal with the interview document:
    expect(screen.getByText('About the Frameworks')).toBeInTheDocument();
    expect(useInterviewBarStore.getState().submitted).toBeNull(); // nothing computed pre-accept
  });
});
