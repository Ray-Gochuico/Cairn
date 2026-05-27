export async function openUrl(url: string): Promise<void> {
  window.open(url, '_blank', 'noopener,noreferrer');
}

export async function openPath(path: string): Promise<void> {
  console.warn('[browser-shim/opener] openPath not supported in browser:', path);
}

export async function revealItemInDir(path: string): Promise<void> {
  console.warn('[browser-shim/opener] revealItemInDir not supported in browser:', path);
}
