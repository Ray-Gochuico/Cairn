import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { usePersonsStore } from '@/stores/persons-store';
import { useCalcScope, useCalcScopeUrlSync } from '@/lib/calculators/use-calc-scope';
import { syncCalcScope, getCalcScopePersonId, __resetCalcScopeForTests } from '@/lib/calculators/calc-view-scope';
import { makePerson } from '../../factories';

function wrapper(entry: string) {
  return ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>
  );
}

beforeEach(() => {
  sessionStorage.clear();
  __resetCalcScopeForTests();
  usePersonsStore.setState({
    persons: [makePerson({ id: 1, name: 'Alice' }), makePerson({ id: 2, name: 'Bob' })],
    isLoading: false, error: null, load: async () => {},
  } as never);
});

describe('useCalcScope', () => {
  it('household default: no router needed', () => {
    const { result } = renderHook(() => useCalcScope());
    expect(result.current.isScoped).toBe(false);
    expect(result.current.personId).toBeNull();
  });
  it('scoped: resolves person + other names from the mirror', () => {
    syncCalcScope(2);
    const { result } = renderHook(() => useCalcScope());
    expect(result.current.isScoped).toBe(true);
    expect(result.current.personName).toBe('Bob');
    expect(result.current.otherName).toBe('Alice');
  });
  it('a stale mirrored id (person gone) degrades to household', () => {
    syncCalcScope(99);
    const { result } = renderHook(() => useCalcScope());
    expect(result.current.isScoped).toBe(false);
    expect(result.current.personId).toBeNull();
  });
});

describe('useCalcScopeUrlSync (the bridge)', () => {
  it('mirrors ?view=p2 to the second person id', () => {
    renderHook(() => useCalcScopeUrlSync(), { wrapper: wrapper('/calculators?view=p2') });
    expect(getCalcScopePersonId()).toBe(2);
  });
  it('D-B2: ?view=joint coerces to household', () => {
    syncCalcScope(1);
    renderHook(() => useCalcScopeUrlSync(), { wrapper: wrapper('/calculators?view=joint') });
    expect(getCalcScopePersonId()).toBeNull();
  });
  it('single-person households never scope', () => {
    usePersonsStore.setState({ persons: [makePerson({ id: 1, name: 'Alice' })] } as never);
    renderHook(() => useCalcScopeUrlSync(), { wrapper: wrapper('/calculators?view=p1') });
    expect(getCalcScopePersonId()).toBeNull();
  });
});
