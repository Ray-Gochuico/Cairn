import { describe, it, expect, beforeEach, vi } from 'vitest';

// The import gate mounts TransactionsSectionImporter → the PDF pipeline;
// mock before imports, verbatim from SectionLayout.test.tsx.
vi.mock('@/pdf/extract', () => ({
  extractTextItems: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/pdf/parse-statement', () => ({
  parseStatement: vi.fn().mockReturnValue({
    issuer: 'GENERIC',
    transactions: [],
  }),
}));
vi.mock('@/lib/statements-archive', () => ({
  archiveStatementPdf: vi.fn().mockResolvedValue(null),
  resolveArchivePath: vi.fn(),
}));

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { createRef, type ComponentType } from 'react';
import HomeGateStep from '@/pages/setup/flow/steps/HomeGateStep';
import RentGateStep from '@/pages/setup/flow/steps/RentGateStep';
import VehiclesGateStep from '@/pages/setup/flow/steps/VehiclesGateStep';
import EquityGateStep from '@/pages/setup/flow/steps/EquityGateStep';
import ImportGateStep from '@/pages/setup/flow/steps/ImportGateStep';
import GoalsGateStep from '@/pages/setup/flow/steps/GoalsGateStep';
import { GATE_CONFIG } from '@/pages/setup/flow/step-registry';
import type { StepComponentProps, } from '@/pages/setup/flow/step-props';
import type { StepSaveResult, FlowCtx } from '@/domain/setup-flow/types';
import { defaultProgressV2 } from '@/lib/setup-progress';
import type { GateStepId } from '@/domain/setup-flow/engine';
import { useSettingsStore } from '@/stores/settings-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { makeHousehold } from '../../../factories';

function ctxWith(overrides: Partial<FlowCtx> = {}): FlowCtx {
  return {
    household: makeHousehold(), persons: [], dependents: [], accounts: [], properties: [],
    housingPayments: [], vehicles: [], vehicleLeases: [], equityGrants: [], loans: [],
    transactions: [], goals: [], progress: defaultProgressV2(), todayIso: '2026-08-09',
    ...overrides,
  };
}

function renderStep(Step: ComponentType<StepComponentProps>, ctx: FlowCtx) {
  const submitRef = createRef<(() => Promise<StepSaveResult>) | null>() as
    React.MutableRefObject<(() => Promise<StepSaveResult>) | null>;
  render(
    <MemoryRouter>
      <Step ctx={ctx} asked={false} onDirtyChange={vi.fn()} submitRef={submitRef} />
    </MemoryRouter>,
  );
  return { submitRef };
}

beforeEach(() => {
  const base = { isLoading: false, error: null, load: async () => {} };
  useSettingsStore.setState({ settings: null, ...base } as never);
  useTransactionsStore.setState({ transactions: [], ...base } as never);
});

const CASES: Array<{
  id: GateStepId;
  Step: ComponentType<StepComponentProps>;
  reveal: string | RegExp;
  revealRole?: 'button';
}> = [
  { id: 'home_gate', Step: HomeGateStep, reveal: 'Properties' },
  { id: 'rent_gate', Step: RentGateStep, reveal: 'Rent / housing payment' },
  { id: 'vehicles_gate', Step: VehiclesGateStep, reveal: 'Vehicles' },
  { id: 'equity_gate', Step: EquityGateStep, reveal: 'Equity grants' },
  {
    id: 'import_gate', Step: ImportGateStep,
    reveal: /Import transactions: drop PDFs or CSVs here, or browse/,
    revealRole: 'button',
  },
  { id: 'goals_gate', Step: GoalsGateStep, reveal: 'Goals' },
];

describe.each(CASES)('$id card gate', ({ id, Step, reveal, revealRole }) => {
  it('asks the CW-30 question; Yes reveals the mapped card/importer', async () => {
    const user = userEvent.setup();
    renderStep(Step, ctxWith());
    expect(screen.getByText(GATE_CONFIG[id].question)).toBeInTheDocument();
    if (revealRole === 'button') {
      expect(screen.queryByRole('button', { name: reveal })).toBeNull();
    } else {
      expect(screen.queryByText(reveal)).toBeNull();
    }
    await user.click(screen.getByRole('radio', { name: 'Yes' }));
    if (revealRole === 'button') {
      expect(screen.getByRole('button', { name: reveal })).toBeInTheDocument();
    } else {
      expect(screen.getByText(reveal)).toBeInTheDocument();
    }
  });

  it('No renders the CW-31 consequence byte-exact', async () => {
    const user = userEvent.setup();
    renderStep(Step, ctxWith());
    await user.click(screen.getByRole('radio', { name: 'No' }));
    expect(screen.getByText(GATE_CONFIG[id].consequence)).toBeInTheDocument();
  });
});

describe('import gate consequence (spec-verbatim)', () => {
  it('is exactly the CW-31h sentence', () => {
    expect(GATE_CONFIG.import_gate.consequence).toBe(
      'You can always do this later on the Spending page.',
    );
  });
});
