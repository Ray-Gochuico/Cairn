import { useMemo } from 'react';
import { useRoadmap } from '@/domain/roadmap/context';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useTickersStore } from '@/stores/tickers-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useHousingPaymentsStore } from '@/stores/housing-payments-store';
import { useInterviewAnswersStore } from '@/stores/interview-answers-store';
import type { InterviewContext } from '@/types/interview';

/**
 * InterviewContext = RoadmapContext + the interview's extra store slices.
 * Read-only composition over useRoadmap() (context.ts:26-55 idiom): fresh
 * immutable snapshot per store change, `today` injected upstream. NO
 * .load() calls here — Roadmap.tsx owns hydration behind its latched
 * useLoadGate (D-GI14; shared-store gate boot-loop gotcha).
 */
export function useInterview(): InterviewContext | null {
  const base = useRoadmap();
  const vehicles = useVehiclesStore((s) => s.vehicles);
  const assetValueSnapshots = useAssetValueSnapshotsStore((s) => s.assetValueSnapshots);
  const settings = useSettingsStore((s) => s.settings);
  const holdings = useHoldingsStore((s) => s.holdings);
  const tickers = useTickersStore((s) => s.tickers);
  const properties = usePropertiesStore((s) => s.properties);
  const housingPayments = useHousingPaymentsStore((s) => s.housingPayments);
  const interviewAnswers = useInterviewAnswersStore((s) => s.answersByKey);

  return useMemo(() => {
    if (!base) return null;
    return { ...base, vehicles, assetValueSnapshots, settings, holdings, tickers, properties, housingPayments, interviewAnswers };
  }, [base, vehicles, assetValueSnapshots, settings, holdings, tickers, properties, housingPayments, interviewAnswers]);
}
