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
      title: "Set the hours you can study",
      description:
        "Your weekly windows are the time StudyFlow plans inside. Everything it tells you is measured against them.",
      href: "/availability",
      action: "Set my hours",
      done: state.weeklyWindows > 0,
    },
    {
      id: "tasks",
      title: "Add your coursework",
      description:
        "Each task needs a deadline and your estimate of how long it takes. That is what gets weighed against your hours.",
      href: "/tasks",
      action: "Add a task",
      done: state.openTasks > 0,
    },
    {
      id: "plan",
      title: "Generate your study plan",
      description:
        "StudyFlow books sessions in the hours you are free, splits long work, and tells you what does not fit before it is too late.",
      href: "/calendar",
      action: "Plan my time",
      done: state.plannedSessions > 0,
    },
    {
      id: "outcomes",
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

/** A brand-new account: nothing set up at all, so the welcome tour is worth showing. */
export function isNewAccount(state: OnboardingState): boolean {
  return state.weeklyWindows === 0 && state.openTasks === 0;
}

const SEEN_KEY = "studyflow:welcome-seen";
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
 * Both flags are read through `useSyncExternalStore`, so a component never has
 * to set state from an effect just to learn what the browser remembers.
 */
const listeners = new Set<() => void>();

export function subscribeToOnboardingFlags(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const welcomeSeen = () => read(SEEN_KEY);
export const gettingStartedHidden = () => read(HIDDEN_KEY);

export function rememberWelcomeSeen(): void {
  write(SEEN_KEY);
  listeners.forEach((listener) => listener());
}

export function rememberGettingStartedHidden(): void {
  write(HIDDEN_KEY);
  listeners.forEach((listener) => listener());
}

/** Lets a student replay the tour and bring the checklist back. */
export function restartOnboarding(): void {
  memoryFlags.delete(SEEN_KEY);
  memoryFlags.delete(HIDDEN_KEY);
  try {
    window.localStorage.removeItem(SEEN_KEY);
    window.localStorage.removeItem(HIDDEN_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
  listeners.forEach((listener) => listener());
}
