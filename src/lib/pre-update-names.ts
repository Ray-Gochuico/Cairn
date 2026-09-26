/**
 * The pre-update copy filename family (v1.7.1 U1, CR-U-3):
 *   cairn-pre-update-<from>-to-<to>-YYYYMMDD-HHMMSS.db
 * Distinct from the manual family `cairn-YYYYMMDD-HHMMSS.db` by construction —
 * manual rotation (backup-restore.ts rotateBackups) and the manual list regex
 * can never match a name whose first character after `cairn-` is a letter, and
 * this regex can never match a manual name. That mutual exclusion is the whole
 * isolation guarantee: neither family evicts the other.
 *
 * Tauri-free on purpose: the boot-error screen may import this statically.
 */
export const PRE_UPDATE_KEEP = 3;

export const PRE_UPDATE_NAME_RE =
  /^cairn-pre-update-(\d+)-to-(\d+)-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.db$/;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** LOCAL wall-clock time, the same convention as backupFilename. */
export function preUpdateCopyFilename(from: number, to: number, now: Date): string {
  const stamp =
    `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-` +
    `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
  return `cairn-pre-update-${from}-to-${to}-${stamp}.db`;
}

export interface PreUpdateCopyName {
  name: string;
  schemaFrom: number;
  schemaTo: number;
  /** Parsed from the name in LOCAL time (the inverse of preUpdateCopyFilename). */
  takenAt: Date;
}

export function parsePreUpdateCopyName(name: string): PreUpdateCopyName | null {
  const m = PRE_UPDATE_NAME_RE.exec(name);
  if (!m) return null;
  const [, from, to, y, mo, d, h, mi, s] = m.map(Number);
  return { name, schemaFrom: from, schemaTo: to, takenAt: new Date(y, mo - 1, d, h, mi, s) };
}
