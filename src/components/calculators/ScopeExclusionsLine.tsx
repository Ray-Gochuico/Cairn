import type { ReactNode } from 'react';
import { formatCurrency } from '@/lib/format';

interface ScopeExclusionsLineProps {
  personName: string;
  /** The card's act — 'solve' (PathToFi register), 'stress test' — read as "{name}'s {noun} counts only …". */
  noun: string;
  jointPortfolio: number;
  unattributedContribution: number;
  testId: string;
  /**
   * B3 (v1.7.0): optional data-testids wrapped around the two dollar figures.
   * PathToFiCard registers them with the basis sweep (`ptf-joint-portfolio`,
   * `ptf-unattributed-contribution`, class invariant) and the sweep reads a
   * figure node or its PARENT, so each figure needs its own element. Absent =
   * the W1 shape (bare text), byte-identical.
   */
  figureTestIds?: { jointPortfolio: string; unattributedContribution: string };
  /** Appended verbatim after "aren't counted." — PathToFi's even-split clause, leading space included by the caller. */
  trailing?: ReactNode;
}

/**
 * W1 (DP-9): THE scope-exclusions sentence, shared by every scoped card. B3
 * migrated PathToFiCard's inline copy onto it (byte-identical output, pinned
 * on both sides). Declared-never-silent: render whenever the card is
 * person-scoped and the hook reports exclusions, per D-W1-11.
 */
export function ScopeExclusionsLine({
  personName,
  noun,
  jointPortfolio,
  unattributedContribution,
  testId,
  figureTestIds,
  trailing,
}: ScopeExclusionsLineProps) {
  const joint = formatCurrency(jointPortfolio);
  const unattributed = formatCurrency(unattributedContribution);
  return (
    <p className="text-xs text-muted-foreground" data-testid={testId}>
      {personName}&#39;s {noun} counts only {personName}&#39;s accounts and contributions — joint accounts (
      {figureTestIds ? <span data-testid={figureTestIds.jointPortfolio}>{joint}</span> : joint}) and unattributed contributions (
      {figureTestIds ? (
        <span data-testid={figureTestIds.unattributedContribution}>{unattributed}</span>
      ) : (
        unattributed
      )}
      /yr) aren&#39;t counted.
      {trailing}
    </p>
  );
}
