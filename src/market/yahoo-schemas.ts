import { z } from 'zod';

/**
 * OBSERVE-ONLY Yahoo shape telemetry (Wave 5, owner constraint — Ray
 * 2026-07-02: boundary validation must never cost data capture).
 *
 * These schemas are consulted with safeParse and the result is used for ONE
 * thing: a console.warn with the stable '[yahoo-shape]' prefix when Yahoo's
 * response drifts from the shape we believe in. The response object itself
 * is NEVER transformed, filtered, or replaced — the ad-hoc per-field salvage
 * in yahoo-client.ts (?? fallbacks, row filters) remains the one and only
 * extraction path, and tests/market/yahoo-degraded-fixtures.test.ts pins its
 * behavior byte-for-byte.
 *
 * Loose objects everywhere: unknown/extra fields are legal forward drift and
 * must not warn. A field going missing or changing type warns — that's the
 * early signal that a silent `?? 0` salvage is quietly eating real data.
 */

const ChartEnvelopeSchema = z.looseObject({
  chart: z.looseObject({
    result: z
      .array(
        z.looseObject({
          meta: z.looseObject({
            regularMarketPrice: z.number().optional(),
            chartPreviousClose: z.number().optional(),
            currency: z.string().optional(),
          }),
          timestamp: z.array(z.number()).optional(),
          indicators: z.looseObject({
            quote: z.array(
              z.looseObject({
                close: z.array(z.number().nullable()).optional(),
              }),
            ),
          }),
        }),
      )
      .nullable(),
    error: z.looseObject({ code: z.string(), description: z.string() }).nullable(),
  }),
});

const HoldingRowSchema = z.looseObject({
  symbol: z.string().optional(),
  holdingPercent: z.looseObject({ raw: z.number().optional() }).optional(),
  holdingName: z.string().nullable().optional(),
});

const QuoteSummaryEnvelopeSchema = z.looseObject({
  quoteSummary: z.looseObject({
    result: z
      .array(
        z.looseObject({
          topHoldings: z
            .looseObject({
              holdings: z.array(HoldingRowSchema).optional(),
              sectorWeightings: z
                .array(
                  z
                    .record(z.string(), z.looseObject({ raw: z.number().optional() }).nullable())
                    .nullable(),
                )
                .optional(),
            })
            .optional(),
          fundProfile: z.looseObject({ categoryName: z.string().nullable().optional() }).optional(),
          price: z.looseObject({ quoteType: z.string().nullable().optional() }).optional(),
          assetProfile: z
            .looseObject({
              sector: z.string().nullable().optional(),
              industry: z.string().nullable().optional(),
            })
            .optional(),
        }),
      )
      .nullable(),
    error: z.unknown().optional(),
  }),
});

/**
 * Log-and-move-on shape check. NEVER throws, NEVER returns anything —
 * structurally incapable of reducing data capture. The '[yahoo-shape]'
 * prefix is a stable grep/observability contract (asserted in tests).
 */
export function observeYahooShape(kind: 'chart' | 'quoteSummary', data: unknown): void {
  try {
    const schema = kind === 'chart' ? ChartEnvelopeSchema : QuoteSummaryEnvelopeSchema;
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      // eslint-disable-next-line no-console
      console.warn(
        `[yahoo-shape] unexpected ${kind} response shape (extraction continues on salvage paths)`,
        parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`),
      );
    }
  } catch {
    // Telemetry must never break the data path — swallow everything.
  }
}
