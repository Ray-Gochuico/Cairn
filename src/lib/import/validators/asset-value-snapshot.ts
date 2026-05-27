// src/lib/import/validators/asset-value-snapshot.ts
import { AssetSnapshotOwnerType } from '@/types/enums';
import type { AssetValueSnapshot } from '@/types/schema';
import type {
  CellError,
  PreviewRow,
  RawRow,
  RowId,
  ValidationContext,
} from '@/lib/import/types';

export type AssetValueSnapshotResolved = Omit<AssetValueSnapshot, 'id'>;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isOwnerType(v: string): v is AssetSnapshotOwnerType {
  return (Object.values(AssetSnapshotOwnerType) as string[]).includes(v);
}

/**
 * Validate one asset-value-snapshot import row. owner_type picks which
 * pool to look up owner_name against (PROPERTY → ctx.properties, VEHICLE
 * → ctx.vehicles). Conflict map keyed by ${ownerType}::${ownerId}::${date}
 * emits status='update' when an existing snapshot exists for that
 * combination.
 */
export function validateAssetValueSnapshotRow(
  raw: RawRow,
  rowId: RowId,
  ctx: ValidationContext,
): PreviewRow<AssetValueSnapshotResolved> {
  const errors: CellError[] = [];

  // owner_type (required enum)
  let ownerType: AssetSnapshotOwnerType = AssetSnapshotOwnerType.PROPERTY;
  const otRaw = (raw.owner_type ?? '').trim();
  if (otRaw.length === 0) {
    errors.push({ field: 'owner_type', message: 'Owner type is required.' });
  } else if (!isOwnerType(otRaw)) {
    errors.push({
      field: 'owner_type',
      message: `Unknown owner type "${otRaw}". Expected one of: ${Object.values(AssetSnapshotOwnerType).join(', ')}`,
    });
  } else {
    ownerType = otRaw;
  }

  // owner_name (required FK, scoped by owner_type)
  let ownerId = 0;
  const ownerName = (raw.owner_name ?? '').trim();
  if (ownerName.length === 0) {
    errors.push({ field: 'owner_name', message: 'Owner is required.' });
  } else {
    const pool =
      ownerType === AssetSnapshotOwnerType.PROPERTY
        ? (ctx.properties ?? [])
        : (ctx.vehicles ?? []);
    const m = pool.find((x) => x.name.toLowerCase() === ownerName.toLowerCase());
    if (!m) {
      const noun = ownerType === AssetSnapshotOwnerType.PROPERTY ? 'property' : 'vehicle';
      errors.push({
        field: 'owner_name',
        message: `No ${noun} named "${ownerName}".`,
      });
    } else {
      ownerId = m.id;
    }
  }

  // snapshot_date (required ISO)
  const dRaw = (raw.snapshot_date ?? '').trim();
  let snapshotDate = '';
  if (dRaw.length === 0) {
    errors.push({ field: 'snapshot_date', message: 'Date is required.' });
  } else if (!ISO_DATE_RE.test(dRaw)) {
    errors.push({ field: 'snapshot_date', message: 'Use YYYY-MM-DD format.' });
  } else {
    snapshotDate = dRaw;
  }

  // value (required ≥ 0)
  const vRaw = (raw.value ?? '').trim();
  let value = 0;
  if (vRaw.length === 0) {
    errors.push({ field: 'value', message: 'Value is required.' });
  } else {
    const n = Number(vRaw);
    if (!Number.isFinite(n) || n < 0) {
      errors.push({ field: 'value', message: 'Must be a non-negative number.' });
    } else {
      value = n;
    }
  }

  const resolved: AssetValueSnapshotResolved = {
    ownerType,
    ownerId,
    snapshotDate,
    value,
  };

  let status: PreviewRow['status'] = 'new';
  let existingId: number | undefined;
  if (errors.length > 0) {
    status = 'error';
  } else if (ctx.existingAssetValueSnapshotConflicts) {
    const key = `${ownerType}::${ownerId}::${snapshotDate}`;
    const existing = ctx.existingAssetValueSnapshotConflicts.get(key);
    if (existing) {
      status = 'update';
      existingId = existing.id;
    }
  }

  return { rowId, raw, resolved, status, errors, existingId };
}

export function assetValueSnapshotTemplateCsv(): string {
  return [
    'owner_type,owner_name,snapshot_date,value',
    `${AssetSnapshotOwnerType.PROPERTY},Main Residence,2026-04-30,765000`,
    `${AssetSnapshotOwnerType.VEHICLE},Daily Driver,2026-04-30,16500`,
  ].join('\n');
}
