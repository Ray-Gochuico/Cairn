/**
 * Browser-shim for `@tauri-apps/plugin-updater`.
 *
 * The Settings → Updates section calls `check()` from this plugin to
 * surface a manual-only update prompt. In the prod Tauri binary the real
 * plugin handles the round-trip; under `npm run dev:browser` there is no
 * updater backend at all, so `check()` resolves to `null` — matching the
 * "no update available" path of the real API. This keeps the Settings
 * lazy-chunk loading cleanly during browser-shim QA without pretending an
 * update exists.
 */

import { Resource } from './api-core';

export type DownloadEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' };

export interface CheckOptions {
  headers?: HeadersInit;
  timeout?: number;
  proxy?: string;
  target?: string;
  allowDowngrades?: boolean;
}

export interface DownloadOptions {
  headers?: HeadersInit;
  timeout?: number;
}

export class Update extends Resource {
  available = false;
  currentVersion = '';
  version = '';
  date: string | undefined = undefined;
  body: string | undefined = undefined;
  rawJson: Record<string, unknown> = {};

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async download(_onEvent?: (progress: DownloadEvent) => void, _options?: DownloadOptions): Promise<void> {
    throw new Error('Updater not available in browser mode');
  }

  async install(): Promise<void> {
    throw new Error('Updater not available in browser mode');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async downloadAndInstall(_onEvent?: (progress: DownloadEvent) => void, _options?: DownloadOptions): Promise<void> {
    throw new Error('Updater not available in browser mode');
  }
}

/**
 * The real `check()` returns `Update | null` — `null` when there is no
 * update available. The browser shim resolves to `null` so consumers that
 * branch on `update === null` see the "up to date" path without crashing.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function check(_options?: CheckOptions): Promise<Update | null> {
  return null;
}
