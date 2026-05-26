import type { SectionStatus } from './sections';

interface Props {
  status: SectionStatus;
  onSetStatus: (s: SectionStatus) => void;
}

// STUB — replaced in γ4 (Section4_History real implementation).
export default function Section4_History(_props: Props) {
  return <div data-testid="section-stub-4">Section 4 stub</div>;
}
