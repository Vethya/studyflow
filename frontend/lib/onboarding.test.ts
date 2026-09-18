import { expect, it } from "vitest";
import { isNewAccount, onboardingProgress, onboardingSteps } from "./onboarding";

const state = {
  weeklyWindows: 0,
  openTasks: 0,
  plannedSessions: 0,
  recordedOutcomes: 0,
};

it("reads every step from the account's own data", () => {
  const steps = onboardingSteps({ ...state, weeklyWindows: 3, openTasks: 2 });

  expect(steps.map((step) => [step.id, step.done])).toEqual([
    ["hours", true],
    ["tasks", true],
    ["plan", false],
    ["outcomes", false],
  ]);
});

it("points at the first unfinished step", () => {
  const progress = onboardingProgress(onboardingSteps({ ...state, weeklyWindows: 1 }));

  expect(progress).toMatchObject({ done: 1, total: 4, complete: false });
  expect(progress.next?.id).toBe("tasks");
});

it("is complete only once a session outcome has been recorded", () => {
  const finished = onboardingProgress(
    onboardingSteps({
      weeklyWindows: 2,
      openTasks: 1,
      plannedSessions: 4,
      recordedOutcomes: 1,
    }),
  );

  expect(finished.complete).toBe(true);
  expect(finished.next).toBeNull();
});

it("treats an account with no hours and no tasks as new", () => {
  expect(isNewAccount(state)).toBe(true);
  expect(isNewAccount({ ...state, openTasks: 1 })).toBe(false);
  expect(isNewAccount({ ...state, weeklyWindows: 1 })).toBe(false);
});
