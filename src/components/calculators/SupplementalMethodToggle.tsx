import type { SupplementalMethod } from '@/lib/calculators/use-supplemental-method';
import { SegmentedControl, type SegmentedOption } from '@/components/ui/segmented-control';

interface SupplementalMethodToggleProps {
  method: SupplementalMethod;
  onChange: (method: SupplementalMethod) => void;
}

const OPTIONS: ReadonlyArray<SegmentedOption<SupplementalMethod>> = [
  { value: 'AGGREGATE', label: 'Aggregate' },
  { value: 'FLAT', label: 'Flat 22%' },
];

/** Segmented control: federal supplemental-wage method (Aggregate vs Flat 22%). */
export function SupplementalMethodToggle({ method, onChange }: SupplementalMethodToggleProps) {
  return <SegmentedControl label="Withholding method" options={OPTIONS} value={method} onChange={onChange} />;
}
