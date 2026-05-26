import type { SectionStatus } from './sections';

interface Props {
  status: SectionStatus;
  onSetStatus: (s: SectionStatus) => void;
}

// STUB — replaced in γ3 (Section3_WhatYouOwe real implementation).
export default function Section3_WhatYouOwe(_props: Props) {
  return <div data-testid="section-stub-3">Section 3 stub</div>;
}
