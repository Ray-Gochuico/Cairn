import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  SECTIONS,
  type SectionIndex,
  type SectionStatus,
} from './sections';
import Section1_WhoYouAre from './Section1_WhoYouAre';
import Section2_WhatYouOwn from './Section2_WhatYouOwn';
import Section3_WhatYouOwe from './Section3_WhatYouOwe';
import Section4_History from './Section4_History';

const STORAGE_KEY = 'setupWizard.progress.v1';

interface Progress {
  currentSection: SectionIndex;
  sectionStatus: Record<SectionIndex, SectionStatus>;
  startedAt: string;
}

function defaultProgress(): Progress {
  return {
    currentSection: 1,
    sectionStatus: { 1: 'pending', 2: 'pending', 3: 'pending', 4: 'pending' },
    startedAt: new Date().toISOString(),
  };
}

function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return defaultProgress();
    const parsed = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      ![1, 2, 3, 4].includes(parsed.currentSection)
    ) {
      return defaultProgress();
    }
    return parsed as Progress;
  } catch {
    return defaultProgress();
  }
}

interface Props {
  /** Optional initial section override (used by ?section= in SetupWizard). */
  initialSection?: SectionIndex;
}

export default function SectionLayout({ initialSection }: Props) {
  const navigate = useNavigate();
  const [progress, setProgress] = useState<Progress>(() => {
    const p = loadProgress();
    if (initialSection !== undefined) p.currentSection = initialSection;
    return p;
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  }, [progress]);

  const setStatus = useCallback(
    (idx: SectionIndex, status: SectionStatus) => {
      setProgress((prev) => {
        const next = {
          ...prev,
          sectionStatus: { ...prev.sectionStatus, [idx]: status },
        };
        // Smoke-test 2026-05-27 finding: clicking "Skip — none of this
        // applies" on the SectionEntryGate marked the section as skipped
        // but didn't advance the wizard. Users had to also click "Next
        // section" at the bottom, which read as the skip not working.
        // Treat skipping the CURRENT section as a one-click advance —
        // they're saying "none of this applies, move on". Re-skipping a
        // non-current section (rare; user clicking back) stays put.
        if (status === 'skipped' && idx === prev.currentSection && idx < 4) {
          next.currentSection = (idx + 1) as SectionIndex;
        }
        return next;
      });
    },
    [],
  );

  const goToSection = useCallback((idx: SectionIndex) => {
    setProgress((prev) => ({ ...prev, currentSection: idx }));
  }, []);

  const handleAdvance = useCallback(() => {
    const cur = progress.currentSection;
    if (cur === 4) return;
    setProgress((prev) => ({
      ...prev,
      sectionStatus: {
        ...prev.sectionStatus,
        [cur]:
          prev.sectionStatus[cur] === 'skipped' ? 'skipped' : 'completed',
      },
      currentSection: (cur + 1) as SectionIndex,
    }));
  }, [progress.currentSection]);

  const handleFinish = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    navigate('/');
  }, [navigate]);

  const currentSection = progress.currentSection;
  const currentMeta = SECTIONS[currentSection - 1];

  const sectionContent = useMemo(() => {
    const props = {
      status: progress.sectionStatus[currentSection],
      onSetStatus: (s: SectionStatus) => setStatus(currentSection, s),
    };
    switch (currentSection) {
      case 1:
        return <Section1_WhoYouAre {...props} />;
      case 2:
        return <Section2_WhatYouOwn {...props} />;
      case 3:
        return <Section3_WhatYouOwe {...props} />;
      case 4:
        return <Section4_History {...props} />;
    }
  }, [currentSection, progress.sectionStatus, setStatus]);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <nav
        aria-label="Setup progress"
        className="flex items-center gap-2"
      >
        {SECTIONS.map((s) => {
          const status = progress.sectionStatus[s.index];
          const isCurrent = s.index === currentSection;
          const clickable =
            status === 'completed' ||
            status === 'skipped' ||
            isCurrent;
          return (
            <button
              key={s.index}
              type="button"
              onClick={() => clickable && goToSection(s.index)}
              disabled={!clickable}
              className={`flex-1 text-xs py-2 px-2 rounded border text-left ${
                isCurrent
                  ? 'border-primary bg-primary/5 font-medium'
                  : status === 'completed'
                    ? 'border-success/40 text-success'
                    : status === 'skipped'
                      ? 'border-muted-foreground/30 text-muted-foreground'
                      : 'border-muted-foreground/20 text-muted-foreground'
              }`}
            >
              <div className="font-medium">Section {s.index} of 4</div>
              <div>{s.label}</div>
              {status === 'completed' && (
                <div className="text-[10px] mt-0.5">✓ done</div>
              )}
              {status === 'skipped' && (
                <div className="text-[10px] mt-0.5">↩ skipped</div>
              )}
            </button>
          );
        })}
      </nav>

      <h1 className="text-2xl font-semibold">
        Section {currentSection} of 4 — {currentMeta.label}
      </h1>

      {sectionContent}

      <div className="flex items-center justify-between pt-6 border-t">
        <Button
          type="button"
          variant="outline"
          disabled={currentSection === 1}
          onClick={() =>
            goToSection((currentSection - 1) as SectionIndex)
          }
        >
          Previous section
        </Button>
        {currentSection === 4 ? (
          <Button type="button" onClick={handleFinish}>
            Finish setup
          </Button>
        ) : (
          <Button type="button" onClick={handleAdvance}>
            Next section
          </Button>
        )}
      </div>
    </div>
  );
}
