/**
 * A-7(7) (v1.7.1): the ONE literal table of the CURRENT disclosure versions.
 *
 * Every unit test that pins a document's current version (a registry-literal
 * drift guard, a rendered `Version x.y` line, a `What changed in version x.y`
 * summary, an acceptance recorded at the current version, or a fixture seeded
 * at the current version so a gate reads ready) imports its value from here.
 * The guards stay LITERAL: this file holds hand-typed strings and imports
 * nothing, so a registry bump still reds every guard until a person edits this
 * table on purpose. It must never read the registry; a derived table would
 * turn every guard into a tautology (disclosure-versions.test.ts pins that).
 *
 * The registry's own pins in tests/legal/disclosures.test.ts stay literal in
 * place (CR-D7-2; every bump edits that file anyway, for its diff contract
 * string). Stale-prior fixtures ('1.4' re-gated, '1.3' two versions back) and
 * test-local documents are NOT current versions and stay literal where they
 * are. e2e specs stay literal (CR-D7-4).
 */
export const DISCLOSURE_VERSIONS = {
  app_wide: '1.5',
  roadmap: '1.0',
  learning: '1.0',
  backtest: '1.5',
  interview: '1.2',
} as const;
