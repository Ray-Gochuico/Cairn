/**
 * W1 (D-W1-8): the stress-window registry — DATA, not code. Ids are persisted
 * in sessionStorage view-state; treat them as stable. Crash windows are the
 * consecutive negative-real-stock-year runs; `stagflation-1973` is deliberately
 * a REGIME window (both oil shocks + the decade's real-bond destruction; it
 * contains up years — the blurb says so). `inflation-2022` deliberately ends at
 * the dataset's last year to exercise the data-ends degradation path honestly.
 * A registry test pins every span inside the bundled dataset, so the CP-24
 * "not available" chip state can only fire on future roster edits.
 */
export interface StressWindow {
  id: string;
  label: string;
  span: { startYear: number; endYear: number };
  blurb: string;
}

export const STRESS_WINDOWS: readonly StressWindow[] = [
  {
    id: 'depression-1929',
    label: 'The 1929 crash',
    span: { startYear: 1929, endYear: 1931 },
    blurb:
      'Three straight down years at the start of the Great Depression — the deepest stock declines in the dataset.',
  },
  {
    id: 'stagflation-1973',
    label: 'The 1970s inflation run',
    span: { startYear: 1973, endYear: 1981 },
    blurb:
      'A regime, not one crash — two oil shocks, up years in between, and inflation grinding bonds all decade.',
  },
  {
    id: 'dotcom-2000',
    label: 'The dot-com crash',
    span: { startYear: 2000, endYear: 2002 },
    blurb: 'Three consecutive negative real years for stocks.',
  },
  {
    id: 'gfc-2008',
    label: 'The 2008 crash',
    span: { startYear: 2008, endYear: 2008 },
    blurb: 'One severe year — stocks fell by more than a third; Treasuries cushioned the blow.',
  },
  {
    id: 'inflation-2022',
    label: 'The 2022 inflation shock',
    span: { startYear: 2022, endYear: 2022 },
    blurb:
      'Stocks and bonds fell together — and the bundled data ends here, so there is no recovery tail to search.',
  },
];
