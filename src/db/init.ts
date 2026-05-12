import { TauriAdapter } from './tauri-adapter';
import { setDatabase } from './db';
import { runMigrations, loadAllMigrations } from './migrations';
import { AccountsRepo } from '@/domain/accounts';
import { HoldingsRepo } from '@/domain/holdings';
import { AccountSnapshotsRepo } from '@/domain/snapshots';
import { PriceCache } from '@/market/price-cache';
import { YahooClient } from '@/market/yahoo-client';
import { deriveLast12Months } from '@/market/snapshot-derivation';

export async function initDatabase(): Promise<void> {
  const adapter = await TauriAdapter.load('sqlite:finance.db');
  setDatabase(adapter);
  const migrations = await loadAllMigrations();
  await runMigrations(adapter, migrations);

  // Kick off snapshot derivation in the background so the UI mounts
  // immediately. Yahoo unreachable on first boot must not crash startup —
  // any failure inside is logged and swallowed.
  void (async () => {
    try {
      const accounts = new AccountsRepo(adapter);
      const holdings = new HoldingsRepo(adapter);
      const snapshots = new AccountSnapshotsRepo(adapter);
      const prices = new PriceCache(adapter, new YahooClient());
      await deriveLast12Months({ accounts, holdings, snapshots, prices });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[init] background snapshot derivation failed:', err);
    }
  })();
}
