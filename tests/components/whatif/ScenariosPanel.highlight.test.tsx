import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
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

  // C1 (smoke M2, 2026-09-02): the Send arrival landed at scrollTop 0 and the
  // ringed row sat below the fold at 1024×700. The row scrolls itself into
  // view — once the layout above has settled, calmly: no focus move, no
  // announcement, and only the ringed row (never the panel, never the page).
  // Targeted restore (NOT vi.restoreAllMocks — that would also reset the
  // vi.fn() store mock above mid-file).
  let scrollSpy: ReturnType<typeof vi.spyOn> | null = null;
  const scrollHarness = () => {
    vi.useFakeTimers();
    const targets: Element[] = [];
    scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) { targets.push(this); });
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} }));
    return { spy: scrollSpy, targets };
  };
  afterEach(() => { scrollSpy?.mockRestore(); scrollSpy = null; vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('scrolls the ringed row into view after the layout settles — calmly (no focus, no aria-live)', () => {
    const { spy, targets } = scrollHarness();
    const { container } = render(
      <MemoryRouter>
        <ScenariosPanel milestones={new Map<number, Milestones>()} onOpenManage={() => {}} highlightId={2} />
      </MemoryRouter>,
    );
    expect(spy).not.toHaveBeenCalled();                    // never on the mount commit
    act(() => { vi.advanceTimersByTime(150); });           // two stable 50ms samples
    expect(targets).toEqual([container.querySelector('li[data-row-id="2"]')]);
    expect(spy).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
    expect(document.activeElement).toBe(document.body);
    expect(container.querySelector('[aria-live]')).toBeNull();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(spy).toHaveBeenCalledTimes(1);                  // once per arrival, not per tick
  });

  it('no highlightId → no scroll at all', () => {
    const { spy } = scrollHarness();
    render(
      <MemoryRouter>
        <ScenariosPanel milestones={new Map<number, Milestones>()} onOpenManage={() => {}} />
      </MemoryRouter>,
    );
    act(() => { vi.advanceTimersByTime(2000); });
    expect(spy).not.toHaveBeenCalled();
  });

  // Review MINOR 2: the arrival scroll was once per MOUNT, not once per
  // ARRIVAL. WhatIf renders the FI-cards row and the projection Card in
  // swapped fragment order for the pills-position toggle, so flipping that
  // toggle re-parents the Card and REMOUNTS this panel — and the effect fired
  // again with the same highlightId, re-centering the ringed row after an
  // unrelated click. The arrival belongs to the page (it owns the navigation
  // state the id arrives on), so the page consumes it and tells the panel;
  // the panel keeps painting the ring for the whole visit either way.
  it('scrollOnArrival={false}: the ring still paints, but a consumed arrival never scrolls again', () => {
    const { spy } = scrollHarness();
    const { container } = render(
      <MemoryRouter>
        <ScenariosPanel
          milestones={new Map<number, Milestones>()}
          onOpenManage={() => {}}
          highlightId={2}
          scrollOnArrival={false}
        />
      </MemoryRouter>,
    );
    act(() => { vi.advanceTimersByTime(2000); });
    expect(spy).not.toHaveBeenCalled();
    expect(container.querySelector('li[data-row-id="2"]')!.className).toContain('ring-1');
  });

  it('reports the scroll back to the page ONCE, when it actually happens (never on the mount commit)', () => {
    const { spy } = scrollHarness();
    const onArrivalScrolled = vi.fn();
    render(
      <MemoryRouter>
        <ScenariosPanel
          milestones={new Map<number, Milestones>()}
          onOpenManage={() => {}}
          highlightId={2}
          onArrivalScrolled={onArrivalScrolled}
        />
      </MemoryRouter>,
    );
    expect(onArrivalScrolled).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(150); });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(onArrivalScrolled).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(onArrivalScrolled).toHaveBeenCalledTimes(1);
  });

  it('a collapsed panel has no row to scroll to — the user\'s collapse choice wins, silently', () => {
    const { spy } = scrollHarness();
    localStorage.setItem('scenariosPanel.collapsed', 'true');   // prefKey() is the identity outside explore mode
    try {
      render(
        <MemoryRouter>
          <ScenariosPanel milestones={new Map<number, Milestones>()} onOpenManage={() => {}} highlightId={2} />
        </MemoryRouter>,
      );
      act(() => { vi.advanceTimersByTime(2000); });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      localStorage.removeItem('scenariosPanel.collapsed');
    }
  });
});
