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
});
