import { z } from 'zod';

/**
 * Backup envelope — the JSON shape we round-trip to disk.
 *
 * Lenient by design: each entity array is `z.array(z.any())` and household
 * is `z.any().nullable()`. The envelope only enforces shape (which keys exist
 * + version pinning), not row-level field validity. Real per-entity validation
 * lives in the repo layer when we apply a restore — those code paths already
 * call the entity Zod schemas before any INSERT.
 *
 * Why lenient at this layer:
 *   - The schema can grow (new entity tables in later phases) without forcing
 *     every backup file to be re-versioned.
 *   - Restore can present per-row errors with a row-level Zod failure, instead
 *     of failing the whole file at envelope parse time.
 *   - It keeps this module zero-coupled to the entity schemas, which evolve
 *     independently.
 *
 * The `version: z.literal(1)` IS strict — bumping the envelope shape requires
 * a deliberate version bump and a migrator.
 */
export const BackupSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  household: z.any().nullable(),
  persons: z.array(z.any()),
  dependents: z.array(z.any()),
  accounts: z.array(z.any()),
  holdings: z.array(z.any()),
  contributions: z.array(z.any()),
  account_snapshots: z.array(z.any()),
  loans: z.array(z.any()),
  loan_payments: z.array(z.any()),
  properties: z.array(z.any()),
  vehicles: z.array(z.any()),
  equity_grants: z.array(z.any()),
  goals: z.array(z.any()),
});

export type Backup = z.infer<typeof BackupSchema>;
export type BackupData = Omit<Backup, 'version' | 'exportedAt'>;

/**
 * Wraps the entity arrays in a versioned envelope and stamps `exportedAt`
 * with the current ISO timestamp. Returns a pretty-printed JSON string so
 * users can sanity-check the file in any text editor.
 */
export function serializeBackup(data: BackupData): string {
  const payload: Backup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    ...data,
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Parses + validates a backup JSON string. Throws with a clear message for
 * malformed JSON; otherwise rethrows the Zod error verbatim so callers can
 * surface field-level details to the user.
 */
export function deserializeBackup(json: string): Backup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid JSON');
  }
  return BackupSchema.parse(parsed);
}
