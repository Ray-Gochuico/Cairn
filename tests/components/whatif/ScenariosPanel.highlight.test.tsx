import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ScenariosPanel } from '@/components/whatif/ScenariosPanel';
import { emptyLeverPayload } from '@/lib/scenarios';
import type { Scenario } from '@/types/scenario';
import type { Milestones } from '@/lib/scenarios';

const baseline: Scenario = {
  id: 1,
  name: 'Baseline',
  isBaseline: true,
  color: '#4f86f7',
  lineStyle: 'solid',
  visible: true,
  isActive: true,
  sortOrder: 0,
  leverPayload: emptyLeverPayload(),
  createdAt: '2026-05-24T00:00:00Z',
  updatedAt: '2026-05-24T00:00:00Z',
};
const sent: Scenario = {
  id: 2,
  name: 'From calculators — May 14, 2026',
  isBaseline: false,
  color: '#f59e0b',
  lineStyle: 'solid',
  visible: true,
  isActive: false,
  sortOrder: 1,
  leverPayload: emptyLeverPayload(),
  createdAt: '2026-05-24T00:00:00Z',
  updatedAt: '2026-05-24T00:00:00Z',
};

vi.mock('@/stores/scenarios-store', () => ({
  useScenariosStore: () => ({
    scenarios: [baseline, sent],
    activeScenario: () => baseline,
    visibleScenarioIds: () => [1, 2],
    toggleVisibility: vi.fn().mockResolvedValue(undefined),
    setActive: vi.fn().mockResolvedValue(undefined),
    duplicate: vi.fn().mockResolvedValue(3),
    remove: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    saveCurrentAsScenario: vi.fn().mockResolvedValue(99),
  }),
}));

describe('ScenariosPanel highlightId (Wave C C11)', () => {
  it('rings ONLY the just-sent row', () => {
    const { container } = render(
      <MemoryRouter>
        <ScenariosPanel
          milestones={new Map<number, Milestones>()}
          onOpenManage={() => {}}
          highlightId={2}
        />
      </MemoryRouter>,
    );
    const row1 = container.querySelector('li[data-row-id="1"]')!;
    const row2 = container.querySelector('li[data-row-id="2"]')!;
    expect(row2.className).toContain('ring-1');
    expect(row1.className).not.toContain('ring-1');
  });
});
