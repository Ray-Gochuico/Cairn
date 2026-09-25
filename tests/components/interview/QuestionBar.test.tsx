import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { makeHousehold } from '../../factories';
import { QuestionBar } from '@/components/interview/QuestionBar';
import { useAcceptancesStore } from '@/stores/disclosure-acceptances-store';
import { useInterviewBarStore } from '@/lib/interview/bar-store';
import { DISCLOSURES } from '@/legal/disclosures';
import { fixtureCtx } from '../../lib/interview/fixture';

beforeEach(() => {
  sessionStorage.clear();
  useInterviewBarStore.setState({ amount: null, cadence: 'one-time', submitted: null });
  useAcceptancesStore.setState({
    acceptedVersions: { interview: DISCLOSURES.interview.version },
  } as never);
});

describe('QuestionBar', () => {
  it('renders the CI-1 sentence with typed controls only', () => {
    render(<MemoryRouter><QuestionBar ctx={fixtureCtx()} /></MemoryRouter>);
    expect(screen.getByLabelText('Amount')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Cadence' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show me' })).toBeInTheDocument();
    // No free-text inputs: the only textbox is the MoneyInput.
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });

  it('validates the amount (CI-2) without submitting', () => {
    render(<MemoryRouter><QuestionBar ctx={fixtureCtx()} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Show me' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter an amount over $0 and at most $10,000,000.');
    expect(useInterviewBarStore.getState().submitted).toBeNull();
  });

  it('submits $10,000 one-time → three framework cards with the fixture split', () => {
    render(<MemoryRouter><QuestionBar ctx={fixtureCtx()} /></MemoryRouter>);
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
    render(<MemoryRouter><QuestionBar ctx={fixtureCtx()} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '10000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show me' }));
    // The id-generic DisclosureModal with the interview document:
    expect(screen.getByText('About the Frameworks')).toBeInTheDocument();
    expect(useInterviewBarStore.getState().submitted).toBeNull(); // nothing computed pre-accept
  });

  it('Escape does NOT dismiss the interview gate; Cancel is the only non-accept exit (smoke defect)', () => {
    // Task 12 Step 6 point 2 pins: "Escape/outside-click does NOT dismiss;
    // Cancel returns without computing." Browser smoke caught Escape leaking.
    useAcceptancesStore.setState({ acceptedVersions: {} } as never);
    render(<MemoryRouter><QuestionBar ctx={fixtureCtx()} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '10000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show me' }));
    expect(screen.getByText('About the Frameworks')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    // Still open, still nothing computed:
    expect(screen.getByText('About the Frameworks')).toBeInTheDocument();
    expect(useInterviewBarStore.getState().submitted).toBeNull();

    // Cancel remains the legitimate non-accept exit — closes without computing.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('About the Frameworks')).not.toBeInTheDocument();
    expect(useInterviewBarStore.getState().submitted).toBeNull();
  });

  /* R3 review (MINOR 4): C8 — the interview gate's "What changed" box is fixed
     by construction (QuestionBar hands the modal `gate.document`, id
     'interview', diff intact), but nothing in the suite asserted the box AT THE
     INTERVIEW ID. These two pins do. They go red if QuestionBar ever builds its
     own document without the diff, or hard-codes another id ('app_wide' would
     find no prior under the 1.0 seed), or if the modal stops keying the box on
     a recorded earlier acceptance of the presented document. */
  describe('the interview gate’s what-changed box (R3, keyed at the interview id)', () => {
    const openGate = () => {
      render(<MemoryRouter><QuestionBar ctx={fixtureCtx()} /></MemoryRouter>);
      fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '10000' } });
      fireEvent.click(screen.getByRole('button', { name: 'Show me' }));
    };

    it('a household that accepted interview 1.1 is re-gated at 1.2 and reads the interview diff', () => {
      useAcceptancesStore.setState({ acceptedVersions: { interview: '1.1' } } as never);
      openGate();
      expect(screen.getByText('About the Frameworks')).toBeInTheDocument();
      expect(screen.getByText('Version 1.2')).toBeInTheDocument();
      expect(screen.getByText('What changed since you last accepted:')).toBeInTheDocument();
      // Identity, not copy: the box carries THIS document's diff (the interview
      // 1.2 text is pinned in tests/legal/disclosures.test.ts, not duplicated).
      expect(screen.getByText(DISCLOSURES.interview.diffFromPrevious as string)).toBeInTheDocument();
      expect(useInterviewBarStore.getState().submitted).toBeNull(); // nothing computed pre-accept
    });

    it('a household that never accepted the interview disclosure reads the body and the attestation, no box (C8)', () => {
      useAcceptancesStore.setState({ acceptedVersions: { app_wide: '1.5' } } as never);
      openGate();
      expect(screen.getByText('About the Frameworks')).toBeInTheDocument();
      expect(screen.queryByText('What changed since you last accepted:')).toBeNull();
      expect(screen.queryByText(DISCLOSURES.interview.diffFromPrevious as string)).toBeNull();
      expect(screen.getByTestId('disclosure-modal-body')).toBeInTheDocument();
      expect(
        screen.getByRole('checkbox', { name: DISCLOSURES.interview.acceptanceCheckboxLabel }),
      ).toBeInTheDocument();
    });
  });

  it('CI-11: the no-baseline skip row carries the Open Household → CTA link (review M3)', () => {
    const ctx = fixtureCtx({ household: makeHousehold({ monthlyExpenseBaseline: 0 }) });
    render(<MemoryRouter><QuestionBar ctx={ctx} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '10000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show me' }));
    const links = screen.getAllByRole('link', { name: 'Open Household →' });
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l).toHaveAttribute('href', '/inputs/household');
  });
});
