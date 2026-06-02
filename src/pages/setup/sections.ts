export type SectionIndex = 1 | 2 | 3 | 4;

export type SectionStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';

export type CardKey =
  | 'household'
  | 'persons'
  | 'employment'
  | 'dependents'
  | 'accounts'
  | 'holdings'
  | 'properties'
  | 'vehicles'
  | 'equity_grants'
  | 'loans'
  | 'snapshots'
  | 'asset_snapshots'
  | 'contributions'
  | 'transactions'
  | 'goals';

export interface CardMeta {
  key: CardKey;
  title: string;
  description: string;
}

export interface SectionMeta {
  index: SectionIndex;
  label: string;
  introTitle: string;
  introBody: string;
  /**
   * Optional calm intro banner shown at the top of the section once the
   * user has started it (distinct from introBody, which appears on the
   * pre-start SectionEntryGate). Added for W6 (Section 3 debt framing).
   */
  intro?: string;
  cards: CardMeta[];
}

export const SECTIONS: SectionMeta[] = [
  {
    index: 1,
    label: 'Who you are',
    introTitle: 'Tell us about your household',
    introBody:
      'This section covers household details, the people in it, employment, and dependents. Skip if you only want to track aggregate balances.',
    cards: [
      {
        key: 'household',
        title: 'Household',
        description: 'Filing status, state, default assumptions.',
      },
      {
        key: 'persons',
        title: 'Persons',
        description: 'You and your partner (one or two adults).',
      },
      {
        key: 'employment',
        title: 'Employment',
        description: 'Salary, bonus, commission for each person.',
      },
      {
        key: 'dependents',
        title: 'Dependents',
        description: 'Children, parents, or others you support.',
      },
    ],
  },
  {
    index: 2,
    label: 'What you own',
    introTitle: 'Your assets',
    introBody:
      'This section covers accounts (checking, savings, brokerage, retirement), individual holdings, real estate, vehicles, and equity grants. Skip if none apply.',
    cards: [
      {
        key: 'accounts',
        title: 'Accounts',
        description:
          'Checking, savings, brokerage, 401k, IRA, HSA, 529, etc.',
      },
      {
        key: 'holdings',
        title: 'Holdings',
        description: 'Stocks, ETFs, mutual funds inside your accounts.',
      },
      {
        key: 'properties',
        title: 'Properties',
        description: 'Real estate you own.',
      },
      {
        key: 'vehicles',
        title: 'Vehicles',
        description: 'Cars, motorcycles, boats, RVs.',
      },
      {
        key: 'equity_grants',
        title: 'Equity grants',
        description: 'RSUs, stock options with vesting schedules.',
      },
    ],
  },
  {
    index: 3,
    label: 'What you owe',
    introTitle: 'Your debts',
    introBody:
      'This section covers loans — mortgages, auto loans, student loans, personal loans, credit cards. Skip if you have no debt.',
    // TODO(copy-confirm): W6 — calm intent-language; coordinator/user to confirm wording.
    intro:
      'Listing what you owe is just for an accurate picture — there is no judgment here. Add each balance you carry, or skip this section entirely if you have no debt.',
    cards: [
      {
        key: 'loans',
        title: 'Loans',
        description:
          'Mortgages, auto, student, personal, credit cards, etc.',
      },
    ],
  },
  {
    index: 4,
    label: 'History & goals',
    introTitle: 'Your history and goals',
    introBody:
      'This section covers historical balances (account snapshots, property/vehicle values over time), past contributions, past transactions, and forward-looking financial goals. Skip if you only want to track from today forward.',
    cards: [
      {
        key: 'snapshots',
        title: 'Account snapshots',
        description: 'Historical balances per account.',
      },
      {
        key: 'asset_snapshots',
        title: 'Property / vehicle values',
        description: 'Historical estimated values.',
      },
      {
        key: 'contributions',
        title: 'Contributions',
        description: 'Past contributions per account.',
      },
      {
        key: 'transactions',
        title: 'Transactions',
        description: 'Past transactions (CSV or PDF statements).',
      },
      {
        key: 'goals',
        title: 'Goals',
        description: 'Retirement, education, home, custom.',
      },
    ],
  },
];
