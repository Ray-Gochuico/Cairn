import { useCallback, useState } from 'react';
import { prefKey } from '@/lib/explore-mode';
import { useDisclosureGate } from '@/legal/useDisclosureGate';
import { useHouseholdStore } from '@/stores/household-store';
import type { DisclosureDocument, DisclosureId } from '@/legal/disclosures';

export type ChartReturnSource = 'ASSUMED' | 'HISTORY';

/**
 * W4 explore ratchet (tests/policy/explore-pref-namespace.test.ts): the
 * return-source key is NAMESPACED, following the W4×W5 reconciliation
 * precedent set by the basis key (src/lib/calculators/dollar-basis.ts). The
 * stored VALUE is an enum, but an explore session must leave nothing behind —
 * `prefKey` puts the key inside the `explore.` prefix that
 * `clearExplorePrefs()` sweeps on exit.
 */
const keyFor = (cardId: string) => prefKey(`calc-chart-source:${cardId}`);

function readSource(cardId: string): ChartReturnSource {
  try {
    return sessionStorage.getItem(keyFor(cardId)) === 'HISTORY' ? 'HISTORY' : 'ASSUMED';
  } catch {
    return 'ASSUMED';
  }
}

/** D-UB3: per-card return-source view state — the usePathMode idiom (a view
 *  switch never sets isOverridden; try/catch + in-memory fallback, the
 *  next-dollar-store resilience idioms). */
export function useChartSource(
  cardId: string,
): [ChartReturnSource, (s: ChartReturnSource) => void] {
  const [source, setSource] = useState<ChartReturnSource>(() => readSource(cardId));
  const set = useCallback(
    (s: ChartReturnSource) => {
      setSource(s);
      try {
        sessionStorage.setItem(keyFor(cardId), s);
      } catch {
        // sessionStorage unavailable — in-memory state still drives the UI.
      }
    },
    [cardId],
  );
  return [source, set];
}

export interface GatedReturnSource {
  /** EFFECTIVE source: a stored HISTORY is demoted to ASSUMED while the
   *  backtest disclosure is un-accepted — restart-safe: no stale stored value
   *  can ever show the fan past the gate. */
  source: ChartReturnSource;
  /** Non-null ⇔ the card must mount DisclosureModal with this document. */
  gateDocument: (DisclosureDocument & { id: DisclosureId }) | null;
  selectAssumed: () => void;
  /** History-button handler: switches, or opens the gate when un-accepted. */
  requestHistory: () => void;
  /** Modal onAccept: records acceptance (shared 'backtest' consent — also
   *  un-gates the Backtest page and the stress cards), then switches. */
  acceptAndSwitch: (version: string) => Promise<void>;
  /** Modal onCancel (and Escape): closes the gate; the view stays Assumed. */
  cancelGate: () => void;
}

/** D-UB10: the deferred in-card gate on first History activation. The Assumed
 *  view never gates; the page is never blocked (W1's in-card rule). */
export function useGatedReturnSource(cardId: string): GatedReturnSource {
  const [stored, setSource] = useChartSource(cardId);
  const gate = useDisclosureGate('backtest');
  const acceptDisclaimer = useHouseholdStore((s) => s.acceptDisclaimer);
  const [gateOpen, setGateOpen] = useState(false);

  const needsAcceptance = gate.state === 'needs-acceptance';
  const source: ChartReturnSource = stored === 'HISTORY' && needsAcceptance ? 'ASSUMED' : stored;

  const requestHistory = useCallback(() => {
    if (needsAcceptance) setGateOpen(true);
    else setSource('HISTORY');
  }, [needsAcceptance, setSource]);

  const acceptAndSwitch = useCallback(
    async (version: string) => {
      await acceptDisclaimer('backtest', version);
      setSource('HISTORY');
      setGateOpen(false);
    },
    [acceptDisclaimer, setSource],
  );

  const selectAssumed = useCallback(() => setSource('ASSUMED'), [setSource]);
  const cancelGate = useCallback(() => setGateOpen(false), []);

  return {
    source,
    gateDocument: gateOpen && gate.state === 'needs-acceptance' ? gate.document : null,
    selectAssumed,
    requestHistory,
    acceptAndSwitch,
    cancelGate,
  };
}
