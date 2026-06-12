import { writeFile, readDir, exists } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';

/**
 * Pure collision-free FILENAME resolver for the PDF statements archive.
 *
 * Given the desired `filename` and the file names already present in the
 * target folder (`existingNames`), returns the filename the archiving step
 * should write to — a bare name, never a path. Joining it onto the
 * picker-chosen folder is the caller's job (`archiveStatementPdf`) via
 * Tauri's platform-aware `join()`; that call is async (an IPC round-trip),
 * which is exactly why this resolver deals in bare names: it stays
 * synchronous, deterministic, and unit-testable.
 *
 * Policy: keep the original filename. On a name collision, insert a
 * ` (N)` suffix before the final extension — ` (2)`, ` (3)`, … — and walk
 * N upward until the name is free. Comparison is case-sensitive (it mirrors
 * the file system the archive lives on; the picker-chosen folder is treated
 * as-is). The impure read of `existingNames` is the caller's job (via the
 * fs plugin).
 */
export function resolveArchivePath(filename: string, existingNames: string[]): string {
  const taken = new Set(existingNames);

  if (!taken.has(filename)) {
    return filename;
  }

  // Split off the final extension, if any, so the suffix lands before it.
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';

  let n = 2;
  let candidate = `${stem} (${n})${ext}`;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${stem} (${n})${ext}`;
  }
  return candidate;
}

/**
 * Best-effort: copy a confirmed import's PDF bytes into the archive `folder`.
 *
 * Returns `null` on success, or a human-readable warning string on any
 * failure (folder missing, permission denied, write error). It NEVER throws
 * — the design spec mandates that an archiving failure surfaces a
 * non-blocking warning and never fails the import that triggered it.
 *
 * Impure: it touches the `tauri-plugin-fs` API and the async `join` from
 * `@tauri-apps/api/path` (platform-correct separators — `\` on Windows).
 * The non-colliding-name logic it delegates to (`resolveArchivePath`) is
 * pure and unit-tested; the join/write wiring is unit-tested with mocks and
 * smoke-tested for real, mirroring `src/pdf/extract.ts`.
 */
export async function archiveStatementPdf(
  folder: string,
  filename: string,
  bytes: Uint8Array,
): Promise<string | null> {
  try {
    if (!(await exists(folder))) {
      return `Statements archive folder not found: ${folder}. The import was saved; the PDF was not archived.`;
    }
    const entries = await readDir(folder);
    const existingNames = entries.map((e) => e.name);
    const name = resolveArchivePath(filename, existingNames);
    const target = await join(folder, name);
    await writeFile(target, bytes);
    return null;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return `Could not archive the statement PDF: ${reason}. The import itself was saved.`;
  }
}
