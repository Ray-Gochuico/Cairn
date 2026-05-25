import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MilestoneStrip from '@/components/whatif/MilestoneStrip';
import type { Scenario } from '@/types/scenario';
import { emptyLeverPayload } from '@/lib/scenarios';

const baseline: Scenario = {
  id: 1, name: 'Baseline', isBaseline: true, color: '#4f86f7', lineStyle: 'solid',
  visible: true, isActive: true, sortOrder: 0, leverPayload: emptyLeverPayload(),
  createdAt: 't', updatedAt: 't',
};
const variant: Scenario = {
  id: 2, name: 'Aggressive', isBaseline: false, color: '#ef8b5a', lineStyle: 'dashed',
  visible: true, isActive: false, sortOrder: 1, leverPayload: emptyLeverPayload(),
  createdAt: 't', updatedAt: 't',
};

describe('MilestoneStrip', () => {
  it('renders one chip per visible scenario with its name and color', () => {
    const milestones = new Map([
      [1, { debtFreeISO: '2029-06', financialIndependenceISO: '2040-01' }],
      [2, { debtFreeISO: '2028-03', financialIndependenceISO: '2037-10' }],
    ]);
    render(<MemoryRouter><MilestoneStrip scenarios={[baseline, variant]} milestones={milestones} /></MemoryRouter>);
    expect(screen.getByText('Baseline')).toBeInTheDocument();
    expect(screen.getByText('Aggressive')).toBeInTheDocument();
    expect(screen.getByText(/Debt-free Jun 2029/i)).toBeInTheDocument();
    expect(screen.getByText(/FI Jan 2040/i)).toBeInTheDocument();
    expect(screen.getByText(/Debt-free Mar 2028/i)).toBeInTheDocument();
    expect(screen.getByText(/FI Oct 2037/i)).toBeInTheDocument();
  });

  it('skips invisible scenarios', () => {
    const m = new Map([[1, { debtFreeISO: '2029-06' }]]);
    render(<MemoryRouter><MilestoneStrip scenarios={[baseline, { ...variant, visible: false }]} milestones={m} /></MemoryRouter>);
    expect(screen.queryByText('Aggressive')).not.toBeInTheDocument();
  });

  it('renders "—" when a milestone is never reached within the horizon', () => {
    const milestones = new Map([[1, { debtFreeISO: undefined, financialIndependenceISO: undefined }]]);
    render(<MemoryRouter><MilestoneStrip scenarios={[baseline]} milestones={milestones} /></MemoryRouter>);
    expect(screen.getByText(/Debt-free —/)).toBeInTheDocument();
    expect(screen.getByText(/FI —/)).toBeInTheDocument();
  });

  it('applies the scenario color to the chip swatch', () => {
    const m = new Map([[1, { debtFreeISO: '2029-06', financialIndependenceISO: '2040-01' }]]);
    const { container } = render(<MemoryRouter><MilestoneStrip scenarios={[baseline]} milestones={m} /></MemoryRouter>);
    const swatch = container.querySelector('[data-testid="milestone-swatch-1"]');
    expect(swatch).not.toBeNull();
    expect((swatch as HTMLElement).style.backgroundColor).toBeTruthy();
  });
});
