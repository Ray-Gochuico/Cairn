import { LoanType } from '@/types/enums';

/**
 * Human-readable label for a LoanType enum value. Used by the
 * LiabilitiesDonut as a fallback when a loan's `name` field is empty or
 * whitespace-only, and previously by the legacy "Liabilities by type"
 * grouping in NetWorth.tsx (deleted in the rewrite — kept here in case a
 * future consumer needs the same mapping).
 */
export function loanTypeLabel(type: LoanType): string {
  switch (type) {
    case LoanType.MORTGAGE:
      return 'Mortgage';
    case LoanType.AUTO:
      return 'Auto';
    case LoanType.STUDENT:
      return 'Student';
    case LoanType.PERSONAL:
      return 'Personal';
    case LoanType.CREDIT_CARD:
      return 'Credit Card';
    case LoanType.OTHER:
      return 'Other';
  }
}
