import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SETUP_PROGRESS_V1_KEY, SETUP_PROGRESS_V2_KEY,
  STEP_ORDER, PART_TO_SECTION, FIRST_STEP_OF_SECTION, stepKey,
  defaultProgressV2, loadSetupProgress, saveSetupProgress, clearSetupProgress,
  hasSetupInProgress, migrateV1, deriveSectionStatus,
  applySectionAdvanced, applySectionSkipped, applySectionPromoted,
  sectionKeys, type SetupProgressV2, type VisibilityInput,
} from '@/lib/setup-progress';

const VI_SOLO: VisibilityInput = {
  hasPartner: false, homeGateStatus: 'pending', propertiesCount: 0, housingPaymentsCount: 0,
};
const VI_COUPLE: VisibilityInput = { ...VI_SOLO, hasPartner: true };

describe('setup-progress v2', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('spine sanity: 16 steps, parts map to sections 1/1/2/3/4', () => {
    expect(STEP_ORDER).toHaveLength(16);
    expect(PART_TO_SECTION).toEqual({ 1: 1, 2: 1, 3: 2, 4: 3, 5: 4 });
    expect(FIRST_STEP_OF_SECTION).toEqual({
      1: 'about_you', 2: 'accounts_gate', 3: 'loans_gate', 4: 'import_gate',
    });
  });

  it('sectionKeys: Section 1 solo = 8 visible keys; couple = 11', () => {
    expect(sectionKeys(1, VI_SOLO, { visibleOnly: true })).toEqual([
      'about_you', 'marital_filing', 'state_city', 'dependents_gate', 'expenses',
      'pay:you', 'retirement:you', 'benefits:you',
    ]);
    expect(sectionKeys(1, VI_COUPLE, { visibleOnly: true })).toEqual([
      'about_you', 'marital_filing', 'state_city', 'dependents_gate', 'expenses',
      'pay:you', 'pay:partner', 'retirement:you', 'retirement:partner',
      'benefits:you', 'benefits:partner',
    ]);
  });

  it('rent_gate is visible only when home_gate is skipped or housing payments exist', () => {
    expect(sectionKeys(2, VI_SOLO, { visibleOnly: true })).toEqual([
      'accounts_gate', 'home_gate', 'vehicles_gate', 'equity_gate',
    ]);
    expect(sectionKeys(2, { ...VI_SOLO, homeGateStatus: 'skipped' }, { visibleOnly: true }))
      .toEqual(['accounts_gate', 'home_gate', 'rent_gate', 'vehicles_gate', 'equity_gate']);
    expect(sectionKeys(2, { ...VI_SOLO, housingPaymentsCount: 1 }, { visibleOnly: true }))
      .toContain('rent_gate');
    // ALL-keys mode always includes it (spec: Section skipped ⇒ ALL mapped steps skipped)
    expect(sectionKeys(2, VI_SOLO, { visibleOnly: false })).toContain('rent_gate');
  });

  it('deriveSectionStatus: pending / in_progress / completed / skipped, with literals', () => {
    expect(deriveSectionStatus(3, {}, VI_SOLO)).toBe('pending');
    expect(deriveSectionStatus(3, { loans_gate: 'in_progress' }, VI_SOLO)).toBe('in_progress');
    expect(deriveSectionStatus(3, { loans_gate: 'completed' }, VI_SOLO)).toBe('completed');
    expect(deriveSectionStatus(3, { loans_gate: 'skipped' }, VI_SOLO)).toBe('skipped');
    // completed requires ≥1 completed among completed/skipped
    const mixed = {
      accounts_gate: 'completed', home_gate: 'skipped',
      vehicles_gate: 'skipped', equity_gate: 'skipped',
    } as const;
    expect(deriveSectionStatus(2, mixed, VI_SOLO)).toBe('completed');
    const oneStarted = { accounts_gate: 'completed' } as const;
    expect(deriveSectionStatus(2, oneStarted, VI_SOLO)).toBe('in_progress');
  });

  it('applySectionAdvanced completes visible pending/in_progress steps, keeps skipped, no-ops a skipped section (v1 parity)', () => {
    let p = defaultProgressV2();
    p = { ...p, statuses: { accounts_gate: 'in_progress', home_gate: 'skipped' } };
    const advanced = applySectionAdvanced(p, 2, VI_SOLO);
    expect(advanced.statuses).toEqual({
      accounts_gate: 'completed', home_gate: 'skipped',
      vehicles_gate: 'completed', equity_gate: 'completed',
    });
    // all-skipped section: advancing keeps it skipped (v1 handleAdvance parity)
    const allSkipped: SetupProgressV2 = {
      ...defaultProgressV2(),
      statuses: {
        accounts_gate: 'skipped', home_gate: 'skipped', rent_gate: 'skipped',
        vehicles_gate: 'skipped', equity_gate: 'skipped',
      },
    };
    expect(applySectionAdvanced(allSkipped, 2, VI_SOLO)).toEqual(allSkipped);
  });

  it('applySectionSkipped marks ALL mapped keys skipped (including invisible rent_gate)', () => {
    const p = applySectionSkipped(defaultProgressV2(), 2, VI_SOLO);
    expect(p.statuses).toEqual({
      accounts_gate: 'skipped', home_gate: 'skipped', rent_gate: 'skipped',
      vehicles_gate: 'skipped', equity_gate: 'skipped',
    });
    expect(deriveSectionStatus(2, p.statuses, VI_SOLO)).toBe('skipped'); // round-trip exact
  });

  it('applySectionPromoted starts pending/skipped visible steps, never downgrades completed', () => {
    const p: SetupProgressV2 = {
      ...defaultProgressV2(),
      statuses: { loans_gate: 'completed' },
    };
    expect(applySectionPromoted(p, 3, VI_SOLO).statuses).toEqual({ loans_gate: 'completed' });
    const p2 = applySectionPromoted(defaultProgressV2(), 3, VI_SOLO);
    expect(p2.statuses).toEqual({ loans_gate: 'in_progress' });
  });

  it('migrateV1: the hand-computed 14-key literal', () => {
    const v1 = {
      currentSection: 3,
      sectionStatus: { 1: 'completed', 2: 'skipped', 3: 'in_progress', 4: 'pending' },
      startedAt: '2026-08-01T00:00:00.000Z',
    };
    const p = migrateV1(v1);
    expect(p).not.toBeNull();
    expect(p!.view).toBe('form');
    expect(p!.startedAt).toBe('2026-08-01T00:00:00.000Z');
    expect(p!.cursor).toEqual({ stepId: 'loans_gate' });
    expect(p!.bindings).toEqual({});
    expect(p!.drafts).toEqual({});
    expect(p!.statuses).toEqual({
      // Section 1 (Parts 1+2, hasPartner=false → 8 visible keys) — completed
      about_you: 'completed', marital_filing: 'completed', state_city: 'completed',
      dependents_gate: 'completed', expenses: 'completed',
      'pay:you': 'completed', 'retirement:you': 'completed', 'benefits:you': 'completed',
      // Section 2 — ALL 5 keys skipped
      accounts_gate: 'skipped', home_gate: 'skipped', rent_gate: 'skipped',
      vehicles_gate: 'skipped', equity_gate: 'skipped',
      // Section 3 — promoted
      loans_gate: 'in_progress',
      // Section 4 — untouched (no keys)
    });
    expect(Object.keys(p!.statuses)).toHaveLength(14);
    // Derivation round-trips the original section statuses exactly
    expect(deriveSectionStatus(1, p!.statuses, VI_SOLO)).toBe('completed');
    expect(deriveSectionStatus(2, p!.statuses, VI_SOLO)).toBe('skipped');
    expect(deriveSectionStatus(3, p!.statuses, VI_SOLO)).toBe('in_progress');
    expect(deriveSectionStatus(4, p!.statuses, VI_SOLO)).toBe('pending');
  });

  it('migrateV1 rejects corrupt shapes', () => {
    expect(migrateV1(null)).toBeNull();
    expect(migrateV1({ currentSection: 9, sectionStatus: {} })).toBeNull();
    expect(migrateV1({ currentSection: 2, sectionStatus: 'garbage' })).toBeNull();
  });

  it('loadSetupProgress migrates v1 once: writes v2, deletes v1', () => {
    localStorage.setItem(SETUP_PROGRESS_V1_KEY, JSON.stringify({
      currentSection: 2,
      sectionStatus: { 1: 'completed', 2: 'pending', 3: 'pending', 4: 'pending' },
      startedAt: '2026-08-01T00:00:00.000Z',
    }));
    const p = loadSetupProgress();
    expect(p.cursor).toEqual({ stepId: 'accounts_gate' });
    expect(localStorage.getItem(SETUP_PROGRESS_V1_KEY)).toBeNull();
    expect(localStorage.getItem(SETUP_PROGRESS_V2_KEY)).not.toBeNull();
  });

  it('loadSetupProgress: corrupt v2 falls back to default (worded view, empty statuses)', () => {
    localStorage.setItem(SETUP_PROGRESS_V2_KEY, '{"version":2,"statuses":"garbage"}');
    const p = loadSetupProgress();
    expect(p.statuses).toEqual({});
    expect(p.view).toBe('worded');
  });

  it('save prunes orphaned keys: unknown step ids, bad roles, role on a non-per-person step', () => {
    const p = defaultProgressV2();
    saveSetupProgress({
      ...p,
      statuses: {
        about_you: 'completed',
        'pay:you': 'completed',
        'pay:cat': 'completed',          // bad role
        'about_you:you': 'completed',    // role on non-per-person step
        bogus_step: 'completed',         // unknown id
      } as SetupProgressV2['statuses'],
    });
    const loaded = loadSetupProgress();
    expect(loaded.statuses).toEqual({ about_you: 'completed', 'pay:you': 'completed' });
  });

  it('hasSetupInProgress counts v2 OR leftover v1; clear removes both', () => {
    expect(hasSetupInProgress()).toBe(false);
    localStorage.setItem(SETUP_PROGRESS_V1_KEY, '{}');
    expect(hasSetupInProgress()).toBe(true);
    localStorage.removeItem(SETUP_PROGRESS_V1_KEY);
    saveSetupProgress(defaultProgressV2());
    expect(hasSetupInProgress()).toBe(true);
    clearSetupProgress();
    expect(hasSetupInProgress()).toBe(false);
    expect(localStorage.getItem(SETUP_PROGRESS_V2_KEY)).toBeNull();
  });

  it('key literals are pinned', () => {
    expect(SETUP_PROGRESS_V1_KEY).toBe('setupWizard.progress.v1');
    expect(SETUP_PROGRESS_V2_KEY).toBe('setupWizard.progress.v2');
    expect(stepKey('pay', 'partner')).toBe('pay:partner');
  });

  describe('origin (Wave A item 3 — revisit-nudge quieting)', () => {
    it('a pre-Wave-A v2 record (no origin field) parses as first-run — additive default', () => {
      const legacy = { ...defaultProgressV2('form') } as Record<string, unknown>;
      delete legacy.origin; // the shipped shape
      localStorage.setItem(SETUP_PROGRESS_V2_KEY, JSON.stringify(legacy));
      expect(loadSetupProgress().origin).toBe('first-run');
      expect(hasSetupInProgress()).toBe(true); // behavior preserved exactly
    });

    it('loadSetupProgress mints a NEW record with the caller-supplied origin', () => {
      expect(loadSetupProgress('revisit').origin).toBe('revisit');
      expect(loadSetupProgress().origin).toBe('first-run'); // default param
    });

    it('an EXISTING record keeps its stored origin regardless of the entry param', () => {
      saveSetupProgress(defaultProgressV2('worded', 'first-run'));
      expect(loadSetupProgress('revisit').origin).toBe('first-run');
    });

    it('hasSetupInProgress: revisit-origin v2 records never count', () => {
      saveSetupProgress(defaultProgressV2('worded', 'revisit'));
      expect(hasSetupInProgress()).toBe(false);
    });

    it('hasSetupInProgress: a leftover v1 key counts even beside a revisit v2 record', () => {
      saveSetupProgress(defaultProgressV2('worded', 'revisit'));
      localStorage.setItem(SETUP_PROGRESS_V1_KEY, '{"currentSection":1}');
      expect(hasSetupInProgress()).toBe(true);
    });

    it('hasSetupInProgress: an unparseable v2 payload still counts (presence semantics)', () => {
      localStorage.setItem(SETUP_PROGRESS_V2_KEY, 'not json');
      expect(hasSetupInProgress()).toBe(true);
    });
  });
});
