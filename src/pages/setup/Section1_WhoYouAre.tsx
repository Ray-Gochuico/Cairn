import type { SectionStatus } from './sections';

interface Props {
  status: SectionStatus;
  onSetStatus: (s: SectionStatus) => void;
}

// STUB — replaced in γ1 (Section1_WhoYouAre real implementation).
export default function Section1_WhoYouAre(_props: Props) {
  return <div data-testid="section-stub-1">Section 1 stub</div>;
}
