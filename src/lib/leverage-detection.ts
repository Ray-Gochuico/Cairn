// src/lib/leverage-detection.ts
export interface LeverageDetection {
  leverageFactor: number;
  direction: 'LONG' | 'SHORT';
}

const TRIPLE_SYMBOLS = /^(TQQQ|UPRO|SPXL|TMF|TYD|TNA|UDOW|SQQQ|SPXU|TZA|SDOW)$/;
const DOUBLE_SYMBOLS = /^(QLD|SSO|TBT|UBT|UCO|DDM|MVV|UWM|SDS|QID)$/;
const SHORT_SYMBOLS = /^(SQQQ|SPXU|TZA|SDOW|SDS|QID)$/;
const TRIPLE_NAME = /\b(3X|TRIPLE|ULTRAPRO)\b/i;
const DOUBLE_NAME = /\b(2X|DOUBLE|ULTRA)\b/i;
const SHORT_NAME = /\b(INVERSE|SHORT|BEAR|UNTRA[- ]?SHORT)\b/i;

export function detectLeverage(ticker: string, name: string | null): LeverageDetection {
  let leverageFactor = 1;
  let direction: 'LONG' | 'SHORT' = 'LONG';

  if (TRIPLE_SYMBOLS.test(ticker)) leverageFactor = 3;
  else if (DOUBLE_SYMBOLS.test(ticker)) leverageFactor = 2;
  else if (name && TRIPLE_NAME.test(name)) leverageFactor = 3;
  else if (name && DOUBLE_NAME.test(name)) leverageFactor = 2;

  if (SHORT_SYMBOLS.test(ticker) || (name && SHORT_NAME.test(name))) direction = 'SHORT';

  return { leverageFactor, direction };
}
