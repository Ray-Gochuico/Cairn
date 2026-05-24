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
 * Append-only audit trail of disclosure acceptances. Writes are
 * idempotent per (household, document, version) tuple — a second
 * accept of the same version is a no-op so the AppDisclaimerGate can
 * safely retry without duplicating rows.
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
}
