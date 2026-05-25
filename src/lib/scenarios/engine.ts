export interface MonthlyState {
  monthISO: string;
  investments: number;
  homeEquity: number;
  cash: number;
  debtByLoan: Record<number, number>;
  netWorth: number;
  incomeAfterTax: number;
  expenses: number;
  savings: number;
  events: string[];
}
