// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { FOCUS_TIMER_STORAGE_KEY, getFocusTimerState, resetFocusTimerStore, subscribeToFocusTimer, updateFocusTimer } from "./focus-timer";
import { clearSignedInOnboarding, gettingStartedHidden, productTourSeen, rememberGettingStartedHidden, rememberProductTourSeen, subscribeToOnboardingFlags } from "./onboarding";
import { markRemindersSeen, resetSeenReminders, seenReminders, subscribeToSeenReminders } from "./reminders";
import { clearPerUserStorage, consumeAccountDeleted, markAccountDeleted } from "./user-storage";

afterEach(() => {
  vi.restoreAllMocks();
  resetFocusTimerStore();
  resetSeenReminders();
  clearSignedInOnboarding();
  window.localStorage.clear();
});

it("clears the signed-in student's local state and leaves the signup email", () => {
  updateFocusTimer((state) => ({ ...state, taskId: "task-1", taskTitle: "Essay draft" }));
  markRemindersSeen(["reminder-1"]);
  rememberProductTourSeen("account-1");
  rememberGettingStartedHidden();
  window.localStorage.setItem("studyflow:signup-email", "keep@example.com");

  const timerListener = vi.fn();
  const reminderListener = vi.fn();
  const onboardingListener = vi.fn();
  const stopTimer = subscribeToFocusTimer(timerListener);
  const stopReminders = subscribeToSeenReminders(reminderListener);
  const stopOnboarding = subscribeToOnboardingFlags(onboardingListener);

  clearPerUserStorage();

  expect(window.localStorage.getItem(FOCUS_TIMER_STORAGE_KEY)).toBeNull();
  expect(getFocusTimerState()).toMatchObject({ taskId: null, taskTitle: null, status: "idle" });
  expect(seenReminders().size).toBe(0);
  expect(window.localStorage.getItem("studyflow:reminders-seen")).toBeNull();
  expect(productTourSeen("account-1")).toBe(true);
  expect(gettingStartedHidden()).toBe(false);
  expect(window.localStorage.getItem("studyflow:tour-seen:account-1")).toBe("1");
  expect(window.localStorage.getItem("studyflow:getting-started-hidden")).toBeNull();
  expect(window.localStorage.getItem("studyflow:signup-email")).toBe("keep@example.com");
  expect(timerListener).toHaveBeenCalled();
  expect(reminderListener).toHaveBeenCalled();
  expect(onboardingListener).toHaveBeenCalled();

  stopTimer();
  stopReminders();
  stopOnboarding();
});

it("still forgets in-memory state when storage refuses to clear", () => {
  updateFocusTimer((state) => ({ ...state, taskId: "task-1", taskTitle: "Essay draft", status: "running", endsAt: 1 }));
  markRemindersSeen(["reminder-1"]);
  rememberProductTourSeen("account-1");
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new Error("blocked");
  });

  expect(() => clearPerUserStorage()).not.toThrow();
  expect(getFocusTimerState().taskTitle).toBeNull();
  expect(getFocusTimerState().status).toBe("idle");
  expect(productTourSeen("account-1")).toBe(true);
});

it("remembers an account deletion only until the redirect reads it", () => {
  expect(consumeAccountDeleted()).toBe(false);
  markAccountDeleted();
  expect(consumeAccountDeleted()).toBe(true);
  expect(consumeAccountDeleted()).toBe(false);
});
