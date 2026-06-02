let warned = false;
function warnOnce(name: string): void {
  if (warned) return;
  warned = true;
  console.warn(`[browser-shim/fs] ${name} is a no-op in browser mode. Statements archive will not write to disk.`);
}

export async function writeFile(_path: string, _bytes: Uint8Array): Promise<void> {
  warnOnce('writeFile');
}

export async function readDir(_path: string): Promise<Array<{ name: string }>> {
  warnOnce('readDir');
  return [];
}

export async function exists(_path: string): Promise<boolean> {
  warnOnce('exists');
  return true;
}

// mkdir + remove back the whole-db backup rotation (src/lib/backup-restore.ts).
// In browser mode the backup/restore actions are gated behind isTauriRuntime()
// and never invoked, but the static imports must still resolve for the browser
// build — these are inert stand-ins matching the upstream signatures.
export async function mkdir(
  _path: string,
  _options?: { recursive?: boolean },
): Promise<void> {
  warnOnce('mkdir');
}

export async function remove(
  _path: string,
  _options?: { recursive?: boolean },
): Promise<void> {
  warnOnce('remove');
}
