/**
 * The four things a student has to do before StudyFlow can answer its one
 * question: "does my coursework fit the time I have?"
 *
 * The steps are derived from real data, never from a stored checklist, so a
 * student who set their hours on another device sees that step already done,
 * and nothing can drift out of step with the account.
 */

export type OnboardingStepId = "hours" | "tasks" | "plan" | "outcomes";

export interface OnboardingStep {
  id: OnboardingStepId;
  title: string;
  /** One short line shown under the next step in the sidebar guide. */
  hint: string;
  description: string;
  /** Where the student goes to do it. */
  href: string;
  action: string;
  done: boolean;
}

export interface OnboardingState {
  weeklyWindows: number;
  openTasks: number;
  plannedSessions: number;
  recordedOutcomes: number;
}

export function onboardingSteps(state: OnboardingState): OnboardingStep[] {
  return [
    {
      id: "hours",
      hint: "When you are free to study each week.",
      title: "Set the hours you can study",
      description:
        "Your weekly windows are the time StudyFlow plans inside. Everything it tells you is measured against them.",
      href: "/availability",
      action: "Set my hours",
      done: state.weeklyWindows > 0,
    },
    {
      id: "tasks",
      hint: "What is due, and roughly how long it takes.",
      title: "Add your coursework",
      description:
        "Each task needs a deadline and your estimate of how long it takes. That is what gets weighed against your hours.",
      href: "/tasks",
      action: "Add a task",
      done: state.openTasks > 0,
    },
    {
      id: "plan",
      hint: "StudyFlow books study sessions for you.",
      title: "Generate your study plan",
      description:
        "StudyFlow books sessions in the hours you are free, splits long work, and tells you what does not fit before it is too late.",
      href: "/calendar",
      action: "Plan my time",
      done: state.plannedSessions > 0,
    },
    {
      id: "outcomes",
      hint: "Tell StudyFlow how a past session went.",
      title: "Say how each session went",
      description:
        "Finished, partly done or missed. That is how remaining work stays honest and how your estimates learn from you.",
      href: "/calendar",
      action: "Open the calendar",
      done: state.recordedOutcomes > 0,
    },
  ];
}

export function onboardingProgress(steps: OnboardingStep[]): {
  done: number;
  total: number;
  complete: boolean;
  next: OnboardingStep | null;
} {
  const done = steps.filter((step) => step.done).length;
  return {
    done,
    total: steps.length,
    complete: done === steps.length,
    next: steps.find((step) => !step.done) ?? null,
  };
}

const HIDDEN_KEY = "studyflow:getting-started-hidden";

const memoryFlags = new Map<string, boolean>();

/** Browser storage can throw or be empty; onboarding must never break a page. */
function read(key: string): boolean {
  if (memoryFlags.has(key)) {
    return memoryFlags.get(key) === true;
  }
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function write(key: string): void {
  memoryFlags.set(key, true);
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    // In-memory flag ensures the session still remembers dismissal.
  }
}

/**
 * The flag is read through `useSyncExternalStore`, so a component never has
 * to set state from an effect just to learn what the browser remembers.
 */
const listeners = new Set<() => void>();

export function subscribeToOnboardingFlags(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const gettingStartedHidden = () => read(HIDDEN_KEY);

export function rememberGettingStartedHidden(): void {
  write(HIDDEN_KEY);
  listeners.forEach((listener) => listener());
}

const TOUR_SEEN_KEY = "studyflow:tour-seen";

function tourSeenKey(accountId: string): string {
  return `${TOUR_SEEN_KEY}:${accountId}`;
}

/**
 * The guided tour opens by itself until this account has finished or skipped
 * it. The flag is per account and is not cleared on logout.
 */
export function productTourSeen(accountId: string | null): boolean {
  if (accountId === null) return true;
  return read(tourSeenKey(accountId));
}

export function rememberProductTourSeen(accountId: string | null): void {
  if (accountId === null) return;
  write(tourSeenKey(accountId));
  listeners.forEach((listener) => listener());
}

const tourRequests = new Set<() => void>();

export function onProductTourRequest(listener: () => void): () => void {
  tourRequests.add(listener);
  return () => tourRequests.delete(listener);
}

/** Replays the tour from the start, e.g. from the account menu. */
export function startProductTour(): void {
  tourRequests.forEach((listener) => listener());
}

/**
 * Drops the getting-started flag for the student who just left.
 * The tour flag stays, keyed by account id, so signing back in does not
 * replay the walkthrough.
 */
export function clearSignedInOnboarding(): void {
  memoryFlags.delete(HIDDEN_KEY);
  try {
    window.localStorage.removeItem(HIDDEN_KEY);
  } catch {
    // Memory is already cleared. A later read may still see storage.
  }
  listeners.forEach((listener) => listener());
}

/** Brings a hidden getting-started guide back. */
export function restartOnboarding(): void {
  memoryFlags.delete(HIDDEN_KEY);
  try {
    window.localStorage.removeItem(HIDDEN_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
  listeners.forEach((listener) => listener());
}
