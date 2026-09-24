import {
  RETURN_SOURCE_ASSUMED_LABEL,
  RETURN_SOURCE_GROUP_LABEL,
  RETURN_SOURCE_HISTORY_LABEL,
} from '@/lib/calculators/history-fan-copy';
import type { ChartReturnSource } from '@/lib/calculators/use-chart-source';
import { SegmentedControl, type SegmentedOption } from '@/components/ui/segmented-control';

interface ReturnSourceControlProps {
  /** The EFFECTIVE source (gate-safe) — never the raw stored value. */
  source: ChartReturnSource;
  onAssumed: () => void;
  onHistory: () => void;
}

const OPTIONS: ReadonlyArray<SegmentedOption<ChartReturnSource>> = [
  { value: 'ASSUMED', label: RETURN_SOURCE_ASSUMED_LABEL },
  { value: 'HISTORY', label: RETURN_SOURCE_HISTORY_LABEL },
];

/** CH-7 / D-UB3: the Assumed | History segmented control — the house
 *  mode-switch idiom (B2: rendered through SegmentedControl), rail-mounted in
 *  RailViewGroup. A return-source choice, NOT a dollar-basis choice — W5
 *  owns the word "basis" and the page-level DollarBasisToggle. */
export function ReturnSourceControl({ source, onAssumed, onHistory }: ReturnSourceControlProps) {
  return (
    <SegmentedControl
      label={RETURN_SOURCE_GROUP_LABEL}
      className="self-start"
      options={OPTIONS}
      value={source}
      onChange={(v) => (v === 'ASSUMED' ? onAssumed() : onHistory())}
    />
  );
}
