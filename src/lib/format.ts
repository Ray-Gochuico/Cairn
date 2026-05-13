export const formatCurrency = (n: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

export const formatPercent = (n: number): string =>
  new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 }).format(n);
