export type VestingTemplateId =
  | 'FOUR_YR_MONTHLY_ONE_YR_CLIFF'
  | 'FOUR_YR_QUARTERLY_ONE_YR_CLIFF'
  | 'THREE_YR_MONTHLY_SIX_MO_CLIFF';

export interface VestingTemplateDescriptor {
  id: VestingTemplateId;
  label: string;
}

export const VESTING_TEMPLATES: VestingTemplateDescriptor[] = [
  { id: 'FOUR_YR_MONTHLY_ONE_YR_CLIFF', label: '4yr monthly w/ 1yr cliff' },
  { id: 'FOUR_YR_QUARTERLY_ONE_YR_CLIFF', label: '4yr quarterly w/ 1yr cliff' },
  { id: 'THREE_YR_MONTHLY_SIX_MO_CLIFF', label: '3yr monthly w/ 6mo cliff' },
];

export interface VestingEntry {
  date: string;
  cumulativePct: number;
}

function addMonths(iso: string, months: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function applyVestingTemplate(id: VestingTemplateId, grantDate: string): VestingEntry[] {
  switch (id) {
    case 'FOUR_YR_MONTHLY_ONE_YR_CLIFF': {
      const rows: VestingEntry[] = [{ date: addMonths(grantDate, 12), cumulativePct: 12 / 48 }];
      for (let i = 13; i <= 48; i++) {
        rows.push({ date: addMonths(grantDate, i), cumulativePct: i / 48 });
      }
      return rows;
    }
    case 'FOUR_YR_QUARTERLY_ONE_YR_CLIFF': {
      const rows: VestingEntry[] = [{ date: addMonths(grantDate, 12), cumulativePct: 4 / 16 }];
      for (let q = 5; q <= 16; q++) {
        rows.push({ date: addMonths(grantDate, q * 3), cumulativePct: q / 16 });
      }
      return rows;
    }
    case 'THREE_YR_MONTHLY_SIX_MO_CLIFF': {
      const rows: VestingEntry[] = [{ date: addMonths(grantDate, 6), cumulativePct: 6 / 36 }];
      for (let i = 7; i <= 36; i++) {
        rows.push({ date: addMonths(grantDate, i), cumulativePct: i / 36 });
      }
      return rows;
    }
  }
}
