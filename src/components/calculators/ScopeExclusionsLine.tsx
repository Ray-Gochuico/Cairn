import { formatCurrency } from '@/lib/format';

interface ScopeExclusionsLineProps {
  personName: string;
  /** The card's act — 'solve' (PathToFi register), 'stress test' — read as "{name}'s {noun} counts only …". */
  noun: string;
  jointPortfolio: number;
  unattributedContribution: number;
  testId: string;
}

/**
 * W1 (DP-9): THE scope-exclusions sentence, shared by the two new cards.
 * Byte-compatible with PathToFiCard's inline line (which stays untouched this
 * wave — migration chip filed). Declared-never-silent: render whenever the
 * card is person-scoped and the hook reports exclusions, per D-W1-11.
 */
export function ScopeExclusionsLine({
  personName,
  noun,
  jointPortfolio,
  unattributedContribution,
  testId,
}: ScopeExclusionsLineProps) {
  return (
    <p className="text-xs text-muted-foreground" data-testid={testId}>
      {personName}&#39;s {noun} counts only {personName}&#39;s accounts and contributions — joint accounts (
      {formatCurrency(jointPortfolio)}) and unattributed contributions ({formatCurrency(unattributedContribution)}
      /yr) aren&#39;t counted.
    </p>
  );
}
