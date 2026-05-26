// src/lib/entity-key.ts
import type { EntityKind } from './net-worth-chart-prefs';

export type { EntityKind };

/**
 * Stable string form for an asset/liability slot in the Net Worth chart.
 * Used as the recharts `<Bar dataKey>` for the entity's stack segment and
 * as the localStorage selection set member.
 *
 * Composite-keyed because account/property/vehicle/loan ids collide
 * across tables — `1` could refer to an account or a loan. Prefixing
 * by kind makes lookups unambiguous.
 */
export function entityKey(kind: EntityKind, id: number): string {
  return `${kind}:${id}`;
}

/**
 * Reverse `entityKey`. Returns `null` for any malformed input — unknown
 * kind, missing colon, negative or non-integer id, extra colons.
 */
export function parseEntityKey(
  s: string,
): { kind: EntityKind; id: number } | null {
  const m = /^(account|property|vehicle|loan):(\d+)$/.exec(s);
  if (!m) return null;
  const id = Number(m[2]);
  if (!Number.isInteger(id) || id <= 0) return null;
  return { kind: m[1] as EntityKind, id };
}
