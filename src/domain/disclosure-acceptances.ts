import type { Database } from '@/db/db';
import type { DisclosureDocumentId } from './household';

export interface DisclosureAcceptance {
  id: number;
  householdId: number;
  documentId: DisclosureDocumentId;
  version: string;
  acceptedAt: string;
}

interface DisclosureAcceptanceRow {
  id: number;
  household_id: number;
  document_id: string;
  version: string;
  accepted_at: string;
}

function rowToAcceptance(row: DisclosureAcceptanceRow): DisclosureAcceptance {
  return {
    id: row.id,
    householdId: row.household_id,
    documentId: row.document_id as DisclosureDocumentId,
    version: row.version,
    acceptedAt: row.accepted_at,
  };
}

/**
 * Acceptance trail for disclosures — the SINGLE source of truth for what the
 * user has accepted (the legacy household cache columns were dropped in 0043;
 * spec §9.6). Append-only in normal operation: writes are idempotent per
 * (household, document, version) tuple, so re-accepting a version is a no-op
 * (acceptDisclaimer can safely retry). The ONE sanctioned mutation is
 * `clearForHousehold`, invoked by the Settings → Advanced "Reset disclaimers"
 * action, which deletes this household's rows so every gate (app_wide,
 * roadmap, learning, …) re-prompts. The disclosure gate reads this table via
 * the boot-loaded acceptances store.
 */
export class DisclosureAcceptancesRepo {
  constructor(private db: Database) {}

  async record(input: Omit<DisclosureAcceptance, 'id'>): Promise<void> {
    try {
      await this.db.execute(
        `INSERT INTO disclosure_acceptances (household_id, document_id, version, accepted_at)
         VALUES (?, ?, ?, ?)`,
        [input.householdId, input.documentId, input.version, input.acceptedAt],
      );
    } catch (err) {
      // UNIQUE(household_id, document_id, version) hit means this version
      // is already recorded — treat as a successful no-op.
      if (String(err).includes('UNIQUE')) return;
      throw err;
    }
  }

  async latestForDocument(documentId: DisclosureDocumentId): Promise<DisclosureAcceptance | null> {
    const rows = await this.db.select<DisclosureAcceptanceRow>(
      `SELECT * FROM disclosure_acceptances
       WHERE document_id = ?
       ORDER BY accepted_at DESC
       LIMIT 1`,
      [documentId],
    );
    return rows[0] ? rowToAcceptance(rows[0]) : null;
  }

  async allForDocument(documentId: DisclosureDocumentId): Promise<DisclosureAcceptance[]> {
    const rows = await this.db.select<DisclosureAcceptanceRow>(
      `SELECT * FROM disclosure_acceptances
       WHERE document_id = ?
       ORDER BY accepted_at ASC`,
      [documentId],
    );
    return rows.map(rowToAcceptance);
  }

  /**
   * Latest accepted version per document id — the projection the gate reads.
   * Self-join (NOT a bare GROUP BY with a non-aggregated `version`, which is
   * non-deterministic in SQLite and could return a STALE version, masking a
   * needed re-prompt): pick the row whose accepted_at equals the per-document
   * max. The per-document aggregate full-scans the table (trivial at
   * disclosure-row volumes — a handful of rows; the UNIQUE index is
   * (household_id, document_id, version), so document_id is not separately
   * indexed). On a same-accepted_at tie for one document_id (UI-unreachable —
   * a single user accepts at most one version per timestamp), the JOIN yields
   * both rows; `ORDER BY da.id` makes the `for…of` last-writer deterministic
   * (the highest id, i.e. last-inserted, wins). Returns { [documentId]: version }.
   */
  async latestVersionsByDocument(): Promise<Record<string, string>> {
    const rows = await this.db.select<{ document_id: string; version: string }>(
      `SELECT da.document_id, da.version
         FROM disclosure_acceptances da
         JOIN (
           SELECT document_id, MAX(accepted_at) AS max_at
           FROM disclosure_acceptances
           GROUP BY document_id
         ) latest
           ON latest.document_id = da.document_id
          AND latest.max_at = da.accepted_at
        ORDER BY da.id`,
    );
    const out: Record<string, string> = {};
    for (const r of rows) out[r.document_id] = r.version;
    return out;
  }

  /**
   * Clear this household's acceptance rows (Reset disclaimers — debug/QA).
   * Scoped by household_id for repo-method fidelity. NOTE: this is the ONE
   * sanctioned mutation of disclosure_acceptances — see the class JSDoc.
   */
  async clearForHousehold(householdId: number): Promise<void> {
    await this.db.execute(
      'DELETE FROM disclosure_acceptances WHERE household_id = ?',
      [householdId],
    );
  }
}
