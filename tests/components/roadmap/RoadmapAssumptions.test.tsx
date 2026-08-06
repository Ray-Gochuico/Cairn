import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoadmapAssumptions } from '@/components/roadmap/RoadmapAssumptions';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { makeHousehold, makePerson } from '../../factories';

const updateHousehold = vi.fn(async () => {});
const updatePerson = vi.fn(async () => {});
const updateAccount = vi.fn(async () => {});

beforeEach(() => {
  vi.clearAllMocks();
  useHouseholdStore.setState({
    household: makeHousehold({ hasWrittenIps: true, upcomingLargePurchase: true }),
    update: updateHousehold,
  } as never);
  usePersonsStore.setState({
    persons: [makePerson({ id: 1, name: 'Alice', jobStability: 'stable' })],
    update: updatePerson,
  } as never);
  useAccountsStore.setState({
    accounts: [{ id: 3, name: 'Fidelity HSA', hasHighFees: false }],
    update: updateAccount,
  } as never);
});

/** The dialog's confirm button (exact 'Ask again') — the row buttons carry
 *  longer 'Ask again: {prompt}' aria-labels, so the exact match is unique. */
const confirmButton = async () => {
  const dialog = await screen.findByRole('dialog');
  return within(dialog).getByRole('button', { name: 'Ask again' });
};

describe('RoadmapAssumptions (Wave C DC1 / IN-G2·G3·G4)', () => {
  it('renders one row per ANSWERED question with the CW14 answer label', () => {
    render(<RoadmapAssumptions />);
    expect(screen.getByText('Assumptions you’ve told the Roadmap')).toBeInTheDocument();
    expect(screen.getByText('Have you written an Investment Policy Statement (IPS)?')).toBeInTheDocument();
    expect(screen.getByText("Is Alice's job stable or unstable?")).toBeInTheDocument();
    expect(screen.getByText('Stable')).toBeInTheDocument();
    expect(screen.getByText('Does Fidelity HSA have high fees?')).toBeInTheDocument();
    // Unanswered questions never render a row:
    expect(screen.queryByText('Do you make regular charitable gifts?')).not.toBeInTheDocument();
  });

  it('renders NOTHING when no question has been answered', () => {
    useHouseholdStore.setState({
      household: makeHousehold({ hasWrittenIps: null, hasHsaQualifiedHdhp: null, makesCharitableGifts: null, upcomingLargePurchase: null }),
    } as never);
    usePersonsStore.setState({ persons: [makePerson({ id: 1, name: 'Alice' })] } as never);
    useAccountsStore.setState({ accounts: [] } as never);
    const { container } = render(<RoadmapAssumptions />);
    expect(container).toBeEmptyDOMElement();
  });

  it('re-ask confirms, then NULLs the answer column so DecisionPrompt re-renders', async () => {
    const user = userEvent.setup();
    render(<RoadmapAssumptions />);
    await user.click(
      screen.getByRole('button', { name: 'Ask again: Have you written an Investment Policy Statement (IPS)?' }),
    );
    expect(await screen.findByText('Ask this question again?')).toBeInTheDocument();
    await user.click(await confirmButton());
    expect(updateHousehold).toHaveBeenCalledWith({ hasWrittenIps: null });
  });

  it('re-asking the large-purchase question clears the follow-up figures too', async () => {
    const user = userEvent.setup();
    render(<RoadmapAssumptions />);
    await user.click(screen.getByRole('button', { name: /Ask again: Any large required purchases/ }));
    await user.click(await confirmButton());
    expect(updateHousehold).toHaveBeenCalledWith({
      upcomingLargePurchase: null,
      upcomingPurchaseAmount: null,
      upcomingPurchaseMonths: null,
    });
  });
});
