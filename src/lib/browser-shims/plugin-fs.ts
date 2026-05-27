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
