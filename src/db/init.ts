import { TauriAdapter } from './tauri-adapter';
import { setDatabase } from './db';
import { runMigrations, loadAllMigrations } from './migrations';

export async function initDatabase(): Promise<void> {
  const adapter = await TauriAdapter.load('sqlite:finance.db');
  setDatabase(adapter);
  const migrations = await loadAllMigrations();
  await runMigrations(adapter, migrations);
}
