import type { SectionStatus } from './sections';

interface Props {
  status: SectionStatus;
  onSetStatus: (s: SectionStatus) => void;
}

// STUB — replaced in γ2 (Section2_WhatYouOwn real implementation).
export default function Section2_WhatYouOwn(_props: Props) {
  return <div data-testid="section-stub-2">Section 2 stub</div>;
}
