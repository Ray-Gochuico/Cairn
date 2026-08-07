import { create } from 'zustand';
import type { Cadence } from '@/types/interview';

export const INTERVIEW_BAR_KEY = 'interview-bar';

export interface InterviewBarSubmission {
  amountCents: number;
  cadence: Cadence;
}

interface InterviewBarState {
  /** Draft field values (dollars; MoneyInput model). */
  amount: number | null;
  cadence: Cadence;
  /** The answered hypothetical the cards render from. Session-only (D-GI13). */
  submitted: InterviewBarSubmission | null;
  setAmount: (v: number | null) => void;
  setCadence: (c: Cadence) => void;
  submit: () => void;
  clear: () => void;
}

function readInitial(): InterviewBarSubmission | null {
  try {
    const raw = sessionStorage.getItem(INTERVIEW_BAR_KEY);
    if (raw == null) return null;
    const parsed = JSON.parse(raw) as InterviewBarSubmission;
    return Number.isInteger(parsed.amountCents) && parsed.amountCents > 0
      && (parsed.cadence === 'one-time' || parsed.cadence === 'per-month')
      ? parsed
      : null;
  } catch {
    return null;
  }
}

// One read at module init (the next-dollar-store idiom): the submission
// survives route flips within the session, never the DB.
const initial = readInitial();

export const useInterviewBarStore = create<InterviewBarState>((set, get) => ({
  amount: initial == null ? null : initial.amountCents / 100,
  cadence: initial?.cadence ?? 'one-time',
  submitted: initial,
  setAmount: (v) => set({ amount: v }),
  setCadence: (c) => set({ cadence: c }),
  submit: () => {
    const { amount, cadence } = get();
    if (amount == null || amount <= 0) return;
    const submitted = { amountCents: Math.round(amount * 100), cadence };
    try {
      sessionStorage.setItem(INTERVIEW_BAR_KEY, JSON.stringify(submitted));
    } catch {
      // sessionStorage unavailable — in-memory state still drives the UI.
    }
    set({ submitted });
  },
  clear: () => {
    try {
      sessionStorage.removeItem(INTERVIEW_BAR_KEY);
    } catch {
      // ignore
    }
    set({ submitted: null });
  },
}));
