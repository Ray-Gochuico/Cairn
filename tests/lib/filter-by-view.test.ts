import { describe, it, expect } from 'vitest';
import {
  filterByOwnerPersonId,
  filterByObligorPersonId,
  filterByForPersonId,
} from '@/lib/filter-by-view';

// Two-person household stubs — only the `id` field is read by the helpers.
const persons = [{ id: 1 }, { id: 2 }];
const personsMissingP1 = [{ id: undefined }, { id: 2 }];

// Table-driven setup: one fixture list per helper. Each row carries a tag
// so the failing assertion in a test reads as something descriptive.
const ownerRows = [
  { tag: 'p1-row', ownerPersonId: 1 },
  { tag: 'p2-row', ownerPersonId: 2 },
  { tag: 'joint-row', ownerPersonId: null },
];

const obligorRows = [
  { tag: 'p1-row', obligorPersonId: 1 },
  { tag: 'p2-row', obligorPersonId: 2 },
  { tag: 'joint-row', obligorPersonId: null },
];

const forRows = [
  { tag: 'p1-row', forPersonId: 1 },
  { tag: 'p2-row', forPersonId: 2 },
  { tag: 'joint-row', forPersonId: null },
];

describe('filterByOwnerPersonId', () => {
  it("filter='household' returns all items (no filtering)", () => {
    expect(filterByOwnerPersonId(ownerRows, 'household', persons)).toEqual(ownerRows);
  });

  it("filter='p1' returns items where ownerPersonId === persons[0].id", () => {
    const out = filterByOwnerPersonId(ownerRows, 'p1', persons);
    expect(out).toHaveLength(1);
    expect(out[0].tag).toBe('p1-row');
  });

  it("filter='p2' returns items where ownerPersonId === persons[1].id", () => {
    const out = filterByOwnerPersonId(ownerRows, 'p2', persons);
    expect(out).toHaveLength(1);
    expect(out[0].tag).toBe('p2-row');
  });

  it("filter='joint' returns items where ownerPersonId === null", () => {
    const out = filterByOwnerPersonId(ownerRows, 'joint', persons);
    expect(out).toHaveLength(1);
    expect(out[0].tag).toBe('joint-row');
  });

  it("filter='p1' does NOT return joint rows (ownerPersonId === null)", () => {
    const out = filterByOwnerPersonId(ownerRows, 'p1', persons);
    expect(out.map((r) => r.tag)).not.toContain('joint-row');
  });

  it("filter='p1' returns empty array when persons[0]?.id is undefined", () => {
    expect(filterByOwnerPersonId(ownerRows, 'p1', personsMissingP1)).toEqual([]);
  });
});

describe('filterByObligorPersonId', () => {
  it("filter='household' returns all items (no filtering)", () => {
    expect(filterByObligorPersonId(obligorRows, 'household', persons)).toEqual(obligorRows);
  });

  it("filter='p1' returns items where obligorPersonId === persons[0].id", () => {
    const out = filterByObligorPersonId(obligorRows, 'p1', persons);
    expect(out).toHaveLength(1);
    expect(out[0].tag).toBe('p1-row');
  });

  it("filter='p2' returns items where obligorPersonId === persons[1].id", () => {
    const out = filterByObligorPersonId(obligorRows, 'p2', persons);
    expect(out).toHaveLength(1);
    expect(out[0].tag).toBe('p2-row');
  });

  it("filter='joint' returns items where obligorPersonId === null", () => {
    const out = filterByObligorPersonId(obligorRows, 'joint', persons);
    expect(out).toHaveLength(1);
    expect(out[0].tag).toBe('joint-row');
  });

  it("filter='p1' does NOT return joint rows (obligorPersonId === null)", () => {
    const out = filterByObligorPersonId(obligorRows, 'p1', persons);
    expect(out.map((r) => r.tag)).not.toContain('joint-row');
  });

  it("filter='p1' returns empty array when persons[0]?.id is undefined", () => {
    expect(filterByObligorPersonId(obligorRows, 'p1', personsMissingP1)).toEqual([]);
  });
});

describe('filterByForPersonId', () => {
  it("filter='household' returns all items (no filtering)", () => {
    expect(filterByForPersonId(forRows, 'household', persons)).toEqual(forRows);
  });

  it("filter='p1' returns items where forPersonId === persons[0].id", () => {
    const out = filterByForPersonId(forRows, 'p1', persons);
    expect(out).toHaveLength(1);
    expect(out[0].tag).toBe('p1-row');
  });

  it("filter='p2' returns items where forPersonId === persons[1].id", () => {
    const out = filterByForPersonId(forRows, 'p2', persons);
    expect(out).toHaveLength(1);
    expect(out[0].tag).toBe('p2-row');
  });

  it("filter='joint' returns items where forPersonId === null", () => {
    const out = filterByForPersonId(forRows, 'joint', persons);
    expect(out).toHaveLength(1);
    expect(out[0].tag).toBe('joint-row');
  });

  it("filter='p1' does NOT return joint rows (forPersonId === null)", () => {
    const out = filterByForPersonId(forRows, 'p1', persons);
    expect(out.map((r) => r.tag)).not.toContain('joint-row');
  });

  it("filter='p1' returns empty array when persons[0]?.id is undefined", () => {
    expect(filterByForPersonId(forRows, 'p1', personsMissingP1)).toEqual([]);
  });
});
