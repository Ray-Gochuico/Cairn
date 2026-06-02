import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { FundHoldingsRepo } from '@/domain/fund-holdings';
import { FundSectorsRepo } from '@/domain/fund-sectors';
import { computeConcentration } from '@/lib/concentration';
import { aggregateBySector, buildSectorMap } from '@/lib/sector-classification';
import type { AssetClass, Direction } from '@/types/schema';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadMigration = (file: string) =>
  readFileSync(resolve(__dirname, `../../src/db/migrations/${file}`), 'utf-8');

/**
 * DONUT-PROTECTION GATE for the upsertHoldings/upsertSectors atomic-batch
 * migration (`db.executeBatch(..., { transaction: true })`).
 *
 * The migration wraps the existing DELETE + per-row INSERT writes in a single
 * transaction. It is strictly behaviour-preserving: same rows in → same rows
 * out. These tests are the proof.
 *
 *  1. GOLDEN CONCENTRATION TEST: seed a representative multi-fund portfolio via
 *     the repos (the real production write path), read it back via the repos
 *     (the real production read path), then drive the EXACT functions the
 *     Investments page's two donuts consume:
 *       - PerTickerDonut → computeConcentration().perTicker  (post-look-through,
 *         from fund_holdings)
 *       - SectorDonut    → aggregateBySector(report.tickerExposures, sectorMap,
 *         fundSectorWeights)  (pre-look-through ticker exposures distributed
 *         across fund_sectors weights)
 *     The captured output is asserted against a hard-coded snapshot. Because the
 *     migration writes byte-identical rows, this snapshot is unchanged from the
 *     pre-migration behaviour — the assertion IS the donut-unaffected proof.
 *
 *  2. ATOMICITY TEST: an upsertHoldings batch whose later INSERT violates the
 *     PRIMARY KEY (duplicate (fund_ticker, holding_ticker, as_of_date)) leaves
 *     the fund's PRIOR holdings fully intact — the DELETE rolled back with the
 *     failed INSERT. Pre-migration (unwrapped DELETE then loop) the DELETE would
 *     have committed and the fund would be left empty: the force-quit data-loss
 *     window. This proves the window is closed.
 */
describe('fund look-through: atomic upsert + donut-output golden', () => {
  let db: SqliteAdapter;
  let holdingsRepo: FundHoldingsRepo;
  let sectorsRepo: FundSectorsRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadMigration('0001_initial.sql') },
      { version: '0021_fund_sectors', sql: loadMigration('0021_fund_sectors.sql') },
      { version: '0041_fund_holding_names', sql: loadMigration('0041_fund_holding_names.sql') },
    ]);
    holdingsRepo = new FundHoldingsRepo(db);
    sectorsRepo = new FundSectorsRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  // --- Representative portfolio (matches the maintainer-facing snapshot) ---
  // Two funds (with both holdings AND sector breakdowns) plus one direct stock.
  // VTI  $100,000  US_TOTAL_MARKET fund
  // VXUS $ 50,000  INTL_DEVELOPED  fund
  // AAPL $ 20,000  direct SINGLE_STOCK position (also a VTI underlying)
  const PORTFOLIO_VALUE = 170_000;

  async function seedPortfolio(): Promise<void> {
    await holdingsRepo.upsertHoldings(
      'VTI',
      [
        { symbol: 'AAPL', weight: 0.06, name: 'Apple Inc' },
        { symbol: 'MSFT', weight: 0.05, name: 'Microsoft Corp' },
        { symbol: 'NVDA', weight: 0.04, name: 'NVIDIA Corp' },
      ],
      '2025-05-01',
    );
    await holdingsRepo.upsertHoldings(
      'VXUS',
      [
        { symbol: 'TSM', weight: 0.02, name: 'Taiwan Semiconductor' },
        { symbol: 'NESN', weight: 0.015, name: 'Nestle SA' },
      ],
      '2025-05-01',
    );
    await sectorsRepo.upsertSectors(
      'VTI',
      [
        { sector: 'Technology', weight: 0.30 },
        { sector: 'Healthcare', weight: 0.13 },
        { sector: 'Financial Services', weight: 0.12 },
      ],
      '2025-05-01',
    );
    await sectorsRepo.upsertSectors(
      'VXUS',
      [
        { sector: 'Technology', weight: 0.10 },
        { sector: 'Financial Services', weight: 0.20 },
      ],
      '2025-05-01',
    );
  }

  // Ticker metadata as the tickers store would supply it. VTI/VXUS are fund
  // asset classes (look-through applies); AAPL is a single stock.
  const tickerMeta = new Map<
    string,
    { assetClass: AssetClass; leverageFactor: number; direction: Direction }
  >([
    ['VTI', { assetClass: 'US_TOTAL_MARKET', leverageFactor: 1, direction: 'LONG' }],
    ['VXUS', { assetClass: 'INTL_DEVELOPED', leverageFactor: 1, direction: 'LONG' }],
    ['AAPL', { assetClass: 'SINGLE_STOCK', leverageFactor: 1, direction: 'LONG' }],
  ]);

  // tickers-store rows (ticker + assetClass + sector + industry) for buildSectorMap.
  const tickerRows = [
    { ticker: 'VTI', assetClass: 'US_TOTAL_MARKET' as AssetClass, sector: null, industry: null },
    { ticker: 'VXUS', assetClass: 'INTL_DEVELOPED' as AssetClass, sector: null, industry: null },
    {
      ticker: 'AAPL',
      assetClass: 'SINGLE_STOCK' as AssetClass,
      sector: 'Technology',
      industry: 'Consumer Electronics',
    },
  ];

  /**
   * Reproduce use-concentration.ts + SectorDonut.tsx exactly, reading the seeded
   * rows back through the repos (the production read path), and return the two
   * donut-facing outputs rounded to cents for a stable snapshot.
   */
  async function computeDonutOutputs() {
    const allHoldings = await holdingsRepo.listAll();
    const allSectors = await sectorsRepo.listAll();

    // fund_holdings → Map<fundTicker, {symbol, weight}[]>  (use-concentration.ts)
    const fundMap = new Map<string, { symbol: string; weight: number }[]>();
    for (const fh of allHoldings) {
      const rows = fundMap.get(fh.fundTicker) ?? [];
      rows.push({ symbol: fh.holdingTicker, weight: fh.weight });
      fundMap.set(fh.fundTicker, rows);
    }

    // fund_sectors → ReadonlyMap<fundTicker, {sector, weight}[]>  (SectorDonut.tsx)
    const fundSectorWeights = new Map<string, { sector: string; weight: number }[]>();
    for (const fs of allSectors) {
      const rows = fundSectorWeights.get(fs.fundTicker) ?? [];
      rows.push({ sector: fs.sector, weight: fs.weight });
      fundSectorWeights.set(fs.fundTicker, rows);
    }

    const holdingsArr = [
      { ticker: 'VTI', value: 100_000 },
      { ticker: 'VXUS', value: 50_000 },
      { ticker: 'AAPL', value: 20_000 },
    ];

    const report = computeConcentration({
      holdings: holdingsArr,
      tickers: tickerMeta,
      fundHoldings: fundMap,
      totalPortfolioValue: PORTFOLIO_VALUE,
    });

    // PerTickerDonut input: post-look-through per-company effective exposures.
    const perTicker = report.perTicker.map((t) => ({
      ticker: t.ticker,
      effectiveExposure: round2(t.effectiveExposure),
      pctOfPortfolio: round6(t.pctOfPortfolio),
    }));

    // SectorDonut input: pre-look-through ticker exposures distributed across
    // fund_sectors weights via aggregateBySector.
    const sectorMap = buildSectorMap(tickerRows);
    const sectorSlices = aggregateBySector(report.tickerExposures, sectorMap, fundSectorWeights)
      .map((s) => ({ name: s.name, value: round2(s.value) }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    return { perTicker, sectorSlices };
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

  // ── HARD-CODED EXPECTED SNAPSHOT ────────────────────────────────────────
  // Because the atomic-batch migration writes byte-identical rows, this is the
  // pre-AND-post-change donut output. Maintainer-facing proof the donuts are
  // unaffected. Derivation (portfolio $170,000):
  //
  //   Per-company (perTicker, post-look-through):
  //     VTI $100k → AAPL .06=6000, MSFT .05=5000, NVDA .04=4000,
  //                 Misc (1-.15=.85)=85000
  //     VXUS $50k → TSM .02=1000, NESN .015=750, Misc (1-.035=.965)=48250
  //     AAPL direct $20k → AAPL 20000
  //     ⇒ AAPL 6000+20000=26000, Misc 85000+48250=133250, MSFT 5000,
  //       NVDA 4000, TSM 1000, NESN 750   (sorted desc by pctOfPortfolio)
  //
  //   Sector (aggregateBySector on tickerExposures = {VTI:100k, VXUS:50k, AAPL:20k}):
  //     VTI 100k:  Tech 30000, Health 13000, Financial 12000, uncovered
  //                (1-.55=.45) → fallback sector 'Unclassified' 45000
  //     VXUS 50k:  Tech 5000, Financial 10000, uncovered (1-.30=.70) →
  //                'Unclassified' 35000
  //     AAPL 20k:  sector 'Technology' (from ticker row) 20000
  //     ⇒ Technology 30000+5000+20000=55000, Financial Services 12000+10000=22000,
  //       Healthcare 13000, Unclassified 45000+35000=80000
  const EXPECTED_PER_TICKER = [
    { ticker: 'Misc', effectiveExposure: 133250, pctOfPortfolio: 0.783824 },
    { ticker: 'AAPL', effectiveExposure: 26000, pctOfPortfolio: 0.152941 },
    { ticker: 'MSFT', effectiveExposure: 5000, pctOfPortfolio: 0.029412 },
    { ticker: 'NVDA', effectiveExposure: 4000, pctOfPortfolio: 0.023529 },
    { ticker: 'TSM', effectiveExposure: 1000, pctOfPortfolio: 0.005882 },
    { ticker: 'NESN', effectiveExposure: 750, pctOfPortfolio: 0.004412 },
  ];

  const EXPECTED_SECTOR_SLICES = [
    { name: 'Financial Services', value: 22000 },
    { name: 'Healthcare', value: 13000 },
    { name: 'Technology', value: 55000 },
    { name: 'Unclassified', value: 80000 },
  ];

  it('GOLDEN: donut outputs (per-company + sector) match the locked snapshot after atomic upserts', async () => {
    await seedPortfolio();
    const { perTicker, sectorSlices } = await computeDonutOutputs();

    expect(perTicker).toEqual(EXPECTED_PER_TICKER);
    expect(sectorSlices).toEqual(EXPECTED_SECTOR_SLICES);

    // Cross-check: per-company effective exposures sum to the full portfolio
    // (every dollar attributed, incl. the synthetic Misc tail). Guards against a
    // silent change to which rows the look-through writes.
    const perTickerSum = perTicker.reduce((a, t) => a + t.effectiveExposure, 0);
    expect(round2(perTickerSum)).toBe(PORTFOLIO_VALUE);

    // Sector slices sum to the full portfolio too (fund exposures fully
    // distributed across sectors + their uncovered residual).
    const sectorSum = sectorSlices.reduce((a, s) => a + s.value, 0);
    expect(round2(sectorSum)).toBe(PORTFOLIO_VALUE);
  });

  it('GOLDEN: re-upserting identical rows reproduces the byte-identical snapshot (idempotent)', async () => {
    await seedPortfolio();
    // Second identical sync — the DELETE-then-reinsert path must land the same
    // rows, so the donut output is unchanged.
    await seedPortfolio();
    const { perTicker, sectorSlices } = await computeDonutOutputs();
    expect(perTicker).toEqual(EXPECTED_PER_TICKER);
    expect(sectorSlices).toEqual(EXPECTED_SECTOR_SLICES);
  });

  it('ATOMICITY: a failed INSERT mid-batch rolls back the DELETE — prior holdings survive (force-quit window closed)', async () => {
    // Seed a fund with known-good holdings.
    await holdingsRepo.upsertHoldings(
      'VTI',
      [
        { symbol: 'AAPL', weight: 0.06, name: 'Apple Inc' },
        { symbol: 'MSFT', weight: 0.05, name: 'Microsoft Corp' },
      ],
      '2025-05-01',
    );
    const before = await holdingsRepo.listForFund('VTI');
    expect(before.map((h) => h.holdingTicker).sort()).toEqual(['AAPL', 'MSFT']);

    // Attempt a re-upsert whose batch contains a duplicate primary key
    // (NVDA twice at the same as_of_date) → the SECOND NVDA INSERT throws a
    // UNIQUE constraint violation AFTER the DELETE and first INSERTs have run
    // inside the transaction. Schema validation passes (all rows are valid),
    // so the failure happens at the DB write, exactly modelling a force-quit
    // partway through the insert loop.
    await expect(
      holdingsRepo.upsertHoldings(
        'VTI',
        [
          { symbol: 'NVDA', weight: 0.07, name: 'NVIDIA Corp' },
          { symbol: 'NVDA', weight: 0.07, name: 'NVIDIA Corp' }, // dup PK → INSERT fails
        ],
        '2025-05-01',
      ),
    ).rejects.toThrow();

    // The whole batch (DELETE + INSERTs) rolled back: the fund still has its
    // ORIGINAL holdings. Pre-migration the bare DELETE would have committed and
    // this fund would be left empty/partial — the exact data-loss window the
    // migration closes.
    const after = await holdingsRepo.listForFund('VTI');
    expect(after.map((h) => h.holdingTicker).sort()).toEqual(['AAPL', 'MSFT']);
    expect(after).toHaveLength(2);
    // Untouched: same as_of_date, same weights.
    expect(after.find((h) => h.holdingTicker === 'AAPL')?.weight).toBeCloseTo(0.06, 6);
    expect(after.find((h) => h.holdingTicker === 'MSFT')?.weight).toBeCloseTo(0.05, 6);
  });

  it('ATOMICITY: upsertSectors failed INSERT mid-batch rolls back the DELETE — prior sectors survive', async () => {
    await sectorsRepo.upsertSectors(
      'VTI',
      [
        { sector: 'Technology', weight: 0.30 },
        { sector: 'Healthcare', weight: 0.13 },
      ],
      '2025-05-01',
    );
    const before = await sectorsRepo.listForFund('VTI');
    expect(before.map((s) => s.sector).sort()).toEqual(['Healthcare', 'Technology']);

    // Duplicate (fund_ticker, sector) PK in the batch → second INSERT throws.
    await expect(
      sectorsRepo.upsertSectors(
        'VTI',
        [
          { sector: 'Financial Services', weight: 0.20 },
          { sector: 'Financial Services', weight: 0.20 }, // dup PK → INSERT fails
        ],
        '2025-06-01',
      ),
    ).rejects.toThrow();

    // Rolled back: original sectors (and original as_of_date) intact.
    const after = await sectorsRepo.listForFund('VTI');
    expect(after.map((s) => s.sector).sort()).toEqual(['Healthcare', 'Technology']);
    expect(after[0].asOfDate).toBe('2025-05-01');
  });
});
