import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { AssetValueSnapshotsRepo } from '@/domain/asset-value-snapshots';
import { commitAssetValueSnapshotImport } from '@/lib/import/commit/asset-value-snapshot';
import type { AssetValueSnapshotResolved } from '@/lib/import/validators/asset-value-snapshot';
import type { PreviewRow } from '@/lib/import/types';
import { AssetSnapshotOwnerType } from '@/types/enums';

function makeRow(
  rowId: number,
  status: PreviewRow['status'],
  resolved: AssetValueSnapshotResolved,
  existingId?: number,
): PreviewRow<AssetValueSnapshotResolved> {
  return { rowId, raw: {}, resolved, status, errors: [], existingId };
}

describe('commitAssetValueSnapshotImport', () => {
  let db: SqliteAdapter;
  let repo: AssetValueSnapshotsRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    repo = new AssetValueSnapshotsRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('inserts new snapshots', async () => {
    const res = await commitAssetValueSnapshotImport(
      [
        makeRow(0, 'new', {
          ownerType: AssetSnapshotOwnerType.PROPERTY,
          ownerId: 5,
          snapshotDate: '2026-04-30',
          value: 765000,
        }),
      ],
      { db, assetValueSnapshots: repo },
    );
    expect(res.inserted).toBe(1);
  });

  it('updates an existing snapshot on status=update', async () => {
    const id = await repo.create({
      ownerType: AssetSnapshotOwnerType.PROPERTY,
      ownerId: 5,
      snapshotDate: '2026-04-30',
      value: 750000,
    });
    const res = await commitAssetValueSnapshotImport(
      [
        makeRow(
          0,
          'update',
          {
            ownerType: AssetSnapshotOwnerType.PROPERTY,
            ownerId: 5,
            snapshotDate: '2026-04-30',
            value: 800000,
          },
          id,
        ),
      ],
      { db, assetValueSnapshots: repo },
    );
    expect(res.updated).toBe(1);
    const found = await repo.findById(id);
    expect(found?.value).toBe(800000);
  });
});
