export async function invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
  console.warn('[browser-shim/api/core] invoke not available in browser mode:', command, args);
  if (command === 'yahoo_quote_summary') {
    return JSON.stringify({ quoteSummary: { result: [] } }) as unknown as T;
  }
  throw new Error(`Tauri command "${command}" not available in browser mode`);
}

export const core = { invoke };
