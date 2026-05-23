import { TauriAdapter } from './tauri-adapter';
import { setDatabase } from './db';
import { runMigrations, loadAllMigrations } from './migrations';
import { runMarketDataRefresh } from '@/market/run-market-data-refresh';

export async function initDatabase(): Promise<void> {
  const adapter = await TauriAdapter.load('sqlite:finance.db');
  setDatabase(adapter);
  const migrations = await loadAllMigrations();
  await runMigrations(adapter, migrations);

  // Run the background market-data derivations. Cadence-gating is added in
  // the next task — for now this preserves today's always-on behavior.
  runMarketDataRefresh(adapter);
}
