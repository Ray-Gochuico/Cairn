export const FilingStatus = {
  SINGLE: 'SINGLE',
  MFJ: 'MFJ',
  MFS: 'MFS',
  HOH: 'HOH',
} as const;
export type FilingStatus = typeof FilingStatus[keyof typeof FilingStatus];

export const AccountType = {
  ACCOUNT_401K: 'ACCOUNT_401K',
  ACCOUNT_ROTH_IRA: 'ACCOUNT_ROTH_IRA',
  ACCOUNT_TRAD_IRA: 'ACCOUNT_TRAD_IRA',
  ACCOUNT_BROKERAGE: 'ACCOUNT_BROKERAGE',
  ACCOUNT_HSA: 'ACCOUNT_HSA',
  ACCOUNT_CRYPTO: 'ACCOUNT_CRYPTO',
  ACCOUNT_CASH: 'ACCOUNT_CASH',
  ACCOUNT_SAVINGS: 'ACCOUNT_SAVINGS',
  ACCOUNT_529: 'ACCOUNT_529',
} as const;
export type AccountType = typeof AccountType[keyof typeof AccountType];

export const LoanType = {
  MORTGAGE: 'MORTGAGE',
  AUTO: 'AUTO',
  STUDENT: 'STUDENT',
  PERSONAL: 'PERSONAL',
  CREDIT_CARD: 'CREDIT_CARD',
  OTHER: 'OTHER',
} as const;
export type LoanType = typeof LoanType[keyof typeof LoanType];

export const PropertyType = {
  PRIMARY_RESIDENCE: 'PRIMARY_RESIDENCE',
  RENTAL: 'RENTAL',
  VACATION_HOME: 'VACATION_HOME',
  LAND: 'LAND',
} as const;
export type PropertyType = typeof PropertyType[keyof typeof PropertyType];

export const GoalType = {
  RETIREMENT: 'RETIREMENT',
  DOWN_PAYMENT: 'DOWN_PAYMENT',
  DEBT_PAYOFF: 'DEBT_PAYOFF',
  EDUCATION: 'EDUCATION',
  EMERGENCY_FUND: 'EMERGENCY_FUND',
  GENERIC: 'GENERIC',
} as const;
export type GoalType = typeof GoalType[keyof typeof GoalType];

export const ContributionSource = {
  PAYCHECK: 'PAYCHECK',
  BONUS: 'BONUS',
  EMPLOYER_MATCH: 'EMPLOYER_MATCH',
  MANUAL: 'MANUAL',
  ROLLOVER: 'ROLLOVER',
  ANNUAL_TOTAL: 'ANNUAL_TOTAL',
} as const;
export type ContributionSource = typeof ContributionSource[keyof typeof ContributionSource];

export const SnapshotSource = {
  AUTO_DERIVED: 'AUTO_DERIVED',
  MANUAL: 'MANUAL',
  USER_CONFIRMED: 'USER_CONFIRMED',
  CSV_IMPORT: 'CSV_IMPORT',
} as const;
export type SnapshotSource = typeof SnapshotSource[keyof typeof SnapshotSource];

export const TransactionSource = {
  CSV_IMPORT: 'CSV_IMPORT',
} as const;
export type TransactionSource = typeof TransactionSource[keyof typeof TransactionSource];

export const AssetClass = {
  US_TOTAL_MARKET: 'US_TOTAL_MARKET',
  US_LARGE_CAP: 'US_LARGE_CAP',
  US_MID_CAP: 'US_MID_CAP',
  US_SMALL_CAP: 'US_SMALL_CAP',
  INTL_DEVELOPED: 'INTL_DEVELOPED',
  EMERGING_MARKETS: 'EMERGING_MARKETS',
  US_BONDS: 'US_BONDS',
  INTL_BONDS: 'INTL_BONDS',
  TIPS: 'TIPS',
  REAL_ESTATE: 'REAL_ESTATE',
  COMMODITIES: 'COMMODITIES',
  CRYPTO: 'CRYPTO',
  SINGLE_STOCK: 'SINGLE_STOCK',
  CASH: 'CASH',
  OTHER: 'OTHER',
} as const;
export type AssetClass = typeof AssetClass[keyof typeof AssetClass];

export const TickerDirection = {
  LONG: 'LONG',
  SHORT: 'SHORT',
} as const;
export type TickerDirection = typeof TickerDirection[keyof typeof TickerDirection];

export const DependentType = {
  CHILD: 'CHILD',
  OTHER: 'OTHER',
} as const;
export type DependentType = typeof DependentType[keyof typeof DependentType];

export const JurisdictionType = {
  FEDERAL: 'FEDERAL',
  FICA: 'FICA',
  STATE: 'STATE',
  CITY: 'CITY',
} as const;
export type JurisdictionType = typeof JurisdictionType[keyof typeof JurisdictionType];

export const Issuer = {
  CHASE: 'CHASE',
  AMEX: 'AMEX',
  CITI: 'CITI',
  DISCOVER: 'DISCOVER',
  CAPITAL_ONE: 'CAPITAL_ONE',
  BOA: 'BOA',
  WELLS_FARGO: 'WELLS_FARGO',
  UNKNOWN: 'UNKNOWN',
} as const;
export type Issuer = (typeof Issuer)[keyof typeof Issuer];

export const CategoryType = {
  NEED: 'NEED',
  WANT: 'WANT',
  SAVINGS: 'SAVINGS',
  INCOME: 'INCOME',
  TRANSFER: 'TRANSFER',
} as const;
export type CategoryType = (typeof CategoryType)[keyof typeof CategoryType];

export const RefreshCadence = {
  EVERY_LAUNCH: 'EVERY_LAUNCH',
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  MANUAL: 'MANUAL',
} as const;
export type RefreshCadence = typeof RefreshCadence[keyof typeof RefreshCadence];

export const FiPillsPosition = {
  ABOVE: 'above',
  BELOW: 'below',
} as const;
export type FiPillsPosition = typeof FiPillsPosition[keyof typeof FiPillsPosition];
