import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScopeExclusionsLine } from '@/components/calculators/ScopeExclusionsLine';

describe('ScopeExclusionsLine (shared, DP-9)', () => {
  it('renders the PathToFi sentence shape with the injected noun and amounts', () => {
    render(
      <ScopeExclusionsLine
        personName="Demo Partner"
        noun="stress test"
        jointPortfolio={8000}
        unattributedContribution={600}
        testId="stress-test-scope-exclusions"
      />,
    );
    expect(screen.getByTestId('stress-test-scope-exclusions')).toHaveTextContent(
      "Demo Partner's stress test counts only Demo Partner's accounts and contributions — joint accounts ($8,000) and unattributed contributions ($600/yr) aren't counted.",
    );
  });

  it("noun 'solve' reproduces PathToFi's own line byte-compatibly", () => {
    render(
      <ScopeExclusionsLine personName="A" noun="solve" jointPortfolio={0} unattributedContribution={0} testId="x" />,
    );
    expect(screen.getByTestId('x')).toHaveTextContent(
      "A's solve counts only A's accounts and contributions — joint accounts ($0) and unattributed contributions ($0/yr) aren't counted.",
    );
  });

  it('B3: figureTestIds wraps the two figures in their own elements (the basis sweep reads a figure node or its parent); text byte-identical', () => {
    render(
      <ScopeExclusionsLine
        personName="Bob"
        noun="solve"
        jointPortfolio={8000}
        unattributedContribution={600}
        testId="x"
        figureTestIds={{ jointPortfolio: 'ptf-joint-portfolio', unattributedContribution: 'ptf-unattributed-contribution' }}
      />,
    );
    expect(screen.getByTestId('ptf-joint-portfolio').textContent).toBe('$8,000');
    expect(screen.getByTestId('ptf-unattributed-contribution').textContent).toBe('$600');
    expect(screen.getByTestId('x').textContent).toBe(
      "Bob's solve counts only Bob's accounts and contributions — joint accounts ($8,000) and unattributed contributions ($600/yr) aren't counted.",
    );
  });

  it("B3: trailing is appended verbatim after \"aren't counted.\" (PathToFi passes its even-split clause with its own leading space)", () => {
    render(
      <ScopeExclusionsLine
        personName="Bob"
        noun="solve"
        jointPortfolio={8000}
        unattributedContribution={600}
        testId="x"
        trailing=" Expenses default to half the household baseline."
      />,
    );
    expect(screen.getByTestId('x').textContent).toBe(
      "Bob's solve counts only Bob's accounts and contributions — joint accounts ($8,000) and unattributed contributions ($600/yr) aren't counted. Expenses default to half the household baseline.",
    );
  });

  it('B3: without the new props the W1 shape is byte-identical and carries no wrapper elements', () => {
    const { container } = render(
      <ScopeExclusionsLine personName="A" noun="stress test" jointPortfolio={0} unattributedContribution={0} testId="x" />,
    );
    expect(container.querySelectorAll('span')).toHaveLength(0);
    expect(screen.getByTestId('x').textContent).toBe(
      "A's stress test counts only A's accounts and contributions — joint accounts ($0) and unattributed contributions ($0/yr) aren't counted.",
    );
  });
});
