// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addZonedDays,
  dayKey,
  describeDeadline,
  formatClock,
  formatDate,
  formatDateTime,
  formatHour,
  inTimeZone,
  isoToLocalInput,
  localInputToIso,
  minutesSinceMidnight,
  nowLocalInput,
  startOfZonedDay,
  zonedCalendarDate,
} from "./datetime";
import {
  analyseFeasibility,
  assessCapacity,
  availableMinutes,
  expandUnavailablePeriods,
  expandWindows,
  intervalMinutes,
  minutesByDay,
  startOfDay,
  subtractPeriods,
  totalMinutes,
  weeklyPatternMinutes,
} from "./capacity";
import {
  gettingStartedHidden,
  isNewAccount,
  onboardingProgress,
  onboardingSteps,
  rememberGettingStartedHidden,
  rememberWelcomeSeen,
  restartOnboarding,
  subscribeToOnboardingFlags,
  welcomeSeen,
} from "./onboarding";
import { applyThemeWithTransition } from "./theme";
import { ALL_TIMEZONES, detectTimezone, formatOffset, withTimezone } from "./timezones";
import {
  SWR_KEYS,
  activeScheduleKey,
  adaptiveEstimateKey,
  effortProgressKey,
  taskDetailKey,
  taskListKey,
  taskSearchKey,
} from "./swr-keys";
import {
  notifyStudyFlowDataChanged,
  notifyStudyFlowSessionInvalidated,
  STUDYFLOW_DATA_CHANGED_EVENT,
  STUDYFLOW_SESSION_INVALIDATED_EVENT,
  subscribeToStudyFlowSessionInvalidation,
} from "./data-events";
import { formatDuration, formatDurationLong } from "./constants";
import {
  resolveEstimateChoiceAction,
  resolveEstimateSelection,
  resolvePreviewSelection,
  toAdaptiveEstimate,
} from "./api/adaptive-contract";
import { toWireOutcome, withLargeActualConfirmation } from "./api/outcome-contract";
import { isPositiveWholeMinute, outcomeSuccessCopy } from "./outcome-ui";
import { validateRegistration } from "./registration-validation";
import type { AcademicTask } from "@/types/task";

const now = new Date("2026-09-14T12:00:00Z");
const zone = "UTC";

const task = (overrides: Partial<AcademicTask> = {}): AcademicTask => ({
  id: "task-1",
  title: "Read",
  category: "Reading",
  deadline: "2026-09-15T12:00:00Z",
  priority: "Medium",
  originalEstimate: 60,
  plannedSource: "Original",
  plannedDuration: 60,
  actualDuration: 0,
  remainingDuration: 60,
  status: "Not Started",
  sessionsCompleted: 0,
  sessionsUpcoming: 0,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  ...overrides,
});

describe("datetime helpers", () => {
  it("converts account-local input and absolute values", () => {
    expect(localInputToIso("2026-08-30T23:59", "UTC")).toBe("2026-08-30T23:59:00.000Z");
    expect(() => localInputToIso("not-a-date", "UTC")).toThrow("Invalid datetime-local value");
    expect(isoToLocalInput("2026-08-30T23:59:00Z", "UTC")).toBe("2026-08-30T23:59");
    expect(nowLocalInput("UTC")).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(inTimeZone("2026-08-30T23:59:00Z", "UTC").getUTCMinutes()).toBe(59);
  });

  it.each([
    ["2026-09-14T13:00:00Z", "Today", "Due today", false, true],
    ["2026-09-15T11:00:00Z", "Tomorrow", "Due tomorrow", false, true],
    ["2026-09-16T11:00:00Z", "2d", "Due in 2 days", false, true],
    ["2026-09-20T11:00:00Z", "6d", "Due in 6 days", false, false],
    ["2026-09-30T11:00:00Z", "Sep 30", "Due Sep 30", false, false],
    ["2026-09-14T10:00:00Z", "Overdue", "Overdue today", true, true],
    ["2026-09-13T10:00:00Z", "1d over", "1 day overdue", true, true],
    ["2026-09-10T10:00:00Z", "4d over", "4 days overdue", true, true],
  ])("describes deadline %s", (deadline, short, long, overdue, urgent) => {
    expect(describeDeadline(deadline, zone, now)).toEqual({ short, long, overdue, urgent });
  });

  it("accepts Date deadlines as well as ISO strings", () => {
    expect(describeDeadline(new Date("2026-09-16T11:00:00Z"), zone, now).short).toBe("2d");
  });

  it("formats calendar values and hours", () => {
    expect(formatClock("2026-09-14T01:05:00Z", "UTC")).toBe("01:05");
    expect(formatDate("2026-09-14T01:05:00Z", "UTC", { month: "short", day: "numeric" })).toBe("Sep 14");
    expect(formatDateTime(new Date("2026-09-14T01:05:00Z"), "UTC", { dateStyle: "short" })).toContain("9");
    expect(dayKey("2026-09-14T23:05:00Z", "UTC")).toBe("2026-09-14");
    expect(minutesSinceMidnight("2026-09-14T01:05:00Z", "UTC")).toBe(65);
    expect(startOfZonedDay(now, zone).getUTCHours()).toBe(0);
    expect(addZonedDays(now, 2, zone).getUTCDate()).toBe(16);
    expect(zonedCalendarDate(2026, 8, 14, zone).getUTCDate()).toBe(14);
    expect(formatHour(0)).toBe("12am");
    expect(formatHour(12)).toBe("12pm");
    expect(formatHour(9)).toBe("9am");
    expect(formatHour(21)).toBe("9pm");
    expect(formatHour(-1)).toBe("11pm");
  });
});

describe("capacity calculations", () => {
  const monday = { id: "m", dayOfWeek: 1, startTime: "09:00", endTime: "11:00" };
  const overnight = { id: "o", dayOfWeek: 1, startTime: "23:00", endTime: "01:00" };
  const period = (startDate: string, endDate: string) => ({ id: startDate, title: "Blocked", startDate, endDate });

  it("expands and clips ordinary and overnight availability", () => {
    const from = new Date("2026-09-14T09:30:00Z");
    const to = new Date("2026-09-15T00:30:00Z");
    expect(startOfDay(from, zone).getUTCHours()).toBe(0);
    expect(expandWindows([monday], from, to, zone)).toHaveLength(1);
    expect(expandWindows([overnight], from, new Date("2026-09-16T02:00:00Z"), zone)).toHaveLength(1);
    expect(expandWindows([monday], new Date("2026-09-15T00:00:00Z"), new Date("2026-09-15T02:00:00Z"), zone)).toEqual([]);
  });

  it("subtracts non-overlapping, leading, trailing, and covering blocks", () => {
    const base = [{ start: new Date("2026-09-14T09:00:00Z"), end: new Date("2026-09-14T13:00:00Z") }];
    expect(subtractPeriods(base, [period("2026-09-14T14:00:00Z", "2026-09-14T15:00:00Z")])).toEqual(base);
    expect(subtractPeriods(base, [period("2026-09-14T10:00:00Z", "2026-09-14T11:00:00Z")])).toHaveLength(2);
    expect(subtractPeriods(base, [period("2026-09-14T08:00:00Z", "2026-09-14T10:00:00Z")])).toHaveLength(1);
    expect(subtractPeriods(base, [period("2026-09-14T12:00:00Z", "2026-09-14T15:00:00Z")])).toHaveLength(1);
    expect(subtractPeriods(base, [period("2026-09-14T08:00:00Z", "2026-09-14T15:00:00Z")])).toEqual([]);
    expect(subtractPeriods(base, [period("2026-09-14T11:00:00Z", "2026-09-14T10:00:00Z")])).toEqual(base);
  });

  it("expands, clips, merges, and measures unavailable periods", () => {
    const from = new Date("2026-09-14T10:00:00Z");
    const to = new Date("2026-09-16T10:00:00Z");
    const periods = [
      period("2026-09-14T09:00:00Z", "2026-09-14T12:00:00Z"),
      period("2026-09-14T11:00:00Z", "2026-09-15T12:00:00Z"),
      period("2026-09-15T15:00:00Z", "2026-09-15T16:00:00Z"),
      period("2026-09-17T00:00:00Z", "2026-09-18T00:00:00Z"),
    ];
    expect(expandUnavailablePeriods(periods, from, to, zone)).toHaveLength(2);
    expect(expandUnavailablePeriods([period("2026-09-14T10:00:00Z", "2026-09-14T10:00:00Z")], from, to, zone)).toEqual([]);
    expect(expandUnavailablePeriods([
      period("2026-09-14T10:00:00Z", "2026-09-14T12:00:00Z"),
      period("2026-09-14T11:00:00Z", "2026-09-14T11:30:00Z"),
    ], from, to, zone)).toHaveLength(1);
    expect(intervalMinutes({ start: new Date(2), end: new Date(1) })).toBe(0);
    const intervals = [{ start: new Date(0), end: new Date(60_000) }];
    expect(intervalMinutes(intervals[0])).toBe(1);
    expect(totalMinutes(intervals)).toBe(1);
    expect(availableMinutes([monday], [], from, to, zone)).toBe(60);
    expect(minutesByDay([monday], [], from, to, zone).size).toBe(1);
  });

  it("assesses open work and earliest-deadline feasibility", () => {
    const windows = [{ ...monday, startTime: "09:00", endTime: "17:00" }];
    const tasks = [
      task({ id: "completed", status: "Completed", remainingDuration: 500 }),
      task({ id: "late", status: "Overdue", deadline: "2026-09-01T00:00:00Z", remainingDuration: 30 }),
      task({ id: "future", status: "In Progress", deadline: "2026-09-15T12:00:00Z", remainingDuration: 60 }),
      task({ id: "later", status: "Not Started", deadline: "2026-10-01T12:00:00Z", remainingDuration: 90 }),
    ];
    const verdict = assessCapacity(tasks, windows, [], 2, zone, now);
    expect(verdict.tasks.map((item) => item.id)).toEqual(["late", "future"]);
    expect(verdict.load).toBeGreaterThan(0);
    expect(assessCapacity([], [], [], 2, zone, now).load).toBe(0);
    expect(assessCapacity([task({ remainingDuration: 15 })], [], [], 2, zone, now).load).toBe(Infinity);
    const feasibility = analyseFeasibility(
      [task({ id: "overdue", status: "Overdue", deadline: "2026-09-10T00:00:00Z", remainingDuration: 10 }), task({ id: "due", deadline: "2026-09-15T12:00:00Z", remainingDuration: 500 })],
      windows,
      [period("2026-09-14T13:00:00Z", "2026-09-14T14:00:00Z")],
      zone,
      now,
    );
    expect(feasibility).toHaveLength(2);
    expect(feasibility[0].availableMinutes).toBe(0);
    expect(feasibility[0].isOverloaded).toBe(true);
    expect(feasibility[0].relevantPeriods).toHaveLength(0);
    expect(feasibility[1].relevantPeriods).toHaveLength(1);
    expect(weeklyPatternMinutes([monday, overnight])).toBe(240);
  });
});

describe("onboarding, events, and browser helpers", () => {
  beforeEach(() => {
    localStorage.clear();
    restartOnboarding();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tracks checklist progress and dismissals", () => {
    const state = { weeklyWindows: 0, openTasks: 0, plannedSessions: 0, recordedOutcomes: 0 };
    expect(onboardingProgress(onboardingSteps(state))).toMatchObject({ done: 0, total: 4, complete: false });
    expect(isNewAccount(state)).toBe(true);
    expect(isNewAccount({ ...state, openTasks: 1 })).toBe(false);
    const listener = vi.fn();
    const unsubscribe = subscribeToOnboardingFlags(listener);
    rememberWelcomeSeen();
    rememberGettingStartedHidden();
    expect(welcomeSeen()).toBe(true);
    expect(gettingStartedHidden()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    restartOnboarding();
    expect(welcomeSeen()).toBe(false);
    expect(gettingStartedHidden()).toBe(false);
  });

  it("survives storage failures and broadcasts data/session events", () => {
    const changed = vi.fn();
    const invalidated = vi.fn();
    window.addEventListener(STUDYFLOW_DATA_CHANGED_EVENT, changed);
    window.addEventListener(STUDYFLOW_SESSION_INVALIDATED_EVENT, invalidated);
    notifyStudyFlowDataChanged();
    notifyStudyFlowDataChanged("/tasks", "POST");
    expect(changed).toHaveBeenCalledTimes(2);
    expect(changed.mock.calls[1][0].detail).toEqual({ path: "/tasks", method: "POST" });

    const close = vi.fn();
    const postMessage = vi.fn();
    let channelMessage: ((event: MessageEvent) => void) | undefined;
    vi.stubGlobal("BroadcastChannel", class {
      close = close;
      postMessage = postMessage;
      addEventListener = vi.fn((_type: string, listener: (event: MessageEvent) => void) => {
        channelMessage = listener;
      });
    });
    const unsubscribe = subscribeToStudyFlowSessionInvalidation(invalidated);
    notifyStudyFlowSessionInvalidated();
    expect(invalidated).toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith("session-invalidated");
    channelMessage?.({ data: "session-invalidated" } as MessageEvent);
    channelMessage?.({ data: "other" } as MessageEvent);
    window.dispatchEvent(new StorageEvent("storage", { key: "other" }));
    window.dispatchEvent(new StorageEvent("storage", { key: "studyflow:session-invalidated" }));
    unsubscribe();
    expect(close).toHaveBeenCalled();
    vi.stubGlobal("BroadcastChannel", undefined);
    const withoutChannel = subscribeToStudyFlowSessionInvalidation(invalidated);
    notifyStudyFlowSessionInvalidated();
    withoutChannel();
    window.removeEventListener(STUDYFLOW_DATA_CHANGED_EVENT, changed);
    window.removeEventListener(STUDYFLOW_SESSION_INVALIDATED_EVENT, invalidated);

    const browserWindow = window;
    vi.stubGlobal("window", undefined);
    notifyStudyFlowDataChanged();
    notifyStudyFlowSessionInvalidated();
    expect(subscribeToStudyFlowSessionInvalidation(vi.fn())()).toBeUndefined();
    vi.stubGlobal("window", browserWindow);
  });

  it("handles unavailable storage, media, and timezone detection", () => {
    const storage = window.localStorage;
    vi.spyOn(storage, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    restartOnboarding();
    expect(welcomeSeen()).toBe(false);
    const browserWindow = window;
    vi.stubGlobal("window", { localStorage: { getItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } } });
    restartOnboarding();
    expect(welcomeSeen()).toBe(false);
    vi.stubGlobal("window", browserWindow);
    vi.spyOn(storage, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    rememberWelcomeSeen();
    vi.spyOn(storage, "removeItem").mockImplementation(() => { throw new Error("blocked"); });
    const listener = vi.fn();
    const unsubscribe = subscribeToOnboardingFlags(listener);
    restartOnboarding();
    expect(listener).toHaveBeenCalled();
    unsubscribe();

    expect(withTimezone(null)).toBeTruthy();
    expect(withTimezone(ALL_TIMEZONES[0].value)).toHaveLength(4);
    expect(withTimezone("Mars/Phobos")[0].group).toBe("Detected");
    expect(formatOffset("UTC")).toBe("+00:00");
    expect(formatOffset("Mars/Phobos")).toBe("—");
    expect(detectTimezone()).toBeTruthy();
    const dateTimeFormat = vi.spyOn(Intl, "DateTimeFormat").mockImplementationOnce(() => {
      throw new Error("blocked");
    });
    expect(detectTimezone()).toBe("UTC");
    dateTimeFormat.mockRestore();
    const originalIntl = Intl;
    const fakeIntl = Object.create(originalIntl) as typeof Intl;
    fakeIntl.DateTimeFormat = function DateTimeFormat() { return {
      resolvedOptions: () => ({ timeZone: "" }),
      formatToParts: () => [],
    }; } as unknown as typeof Intl.DateTimeFormat;
    vi.stubGlobal("Intl", fakeIntl);
    expect(detectTimezone()).toBe("UTC");
    expect(formatOffset("UTC")).toBe("+00:00");
    vi.stubGlobal("Intl", originalIntl);
    expect(formatOffset("UTC")).toBe("+00:00");
  });
});

describe("cache keys, theme, and contracts", () => {
  it("creates stable SWR keys for empty and populated inputs", () => {
    expect(taskListKey()).toBe(SWR_KEYS.tasks);
    expect(taskListKey({ status: "Completed" })).toEqual([SWR_KEYS.tasks, { status: "Completed" }]);
    expect(taskSearchKey("  ")).toBeNull();
    expect(taskSearchKey("  read ")).toEqual([SWR_KEYS.taskSearch, "read"]);
    expect(taskDetailKey("task-1")).toEqual(["studyflow/task", "task-1"]);
    expect(activeScheduleKey(null)).toBeNull();
    expect(activeScheduleKey([task()])).toHaveLength(2);
    expect(effortProgressKey([task()], null, false)).toEqual([
      SWR_KEYS.effortProgress,
      expect.any(String),
      "empty",
    ]);
    expect(effortProgressKey(null, null, false)).toBeNull();
    expect(effortProgressKey([task()], null, true)).toBeNull();
    expect(effortProgressKey([task()], { id: "s", sessions: [], createdAt: "", isActive: true }, false)).toHaveLength(3);
    expect(effortProgressKey([task()], { id: "s", sessions: [{ id: "session", taskId: "task-1", taskTitle: "Read", category: "Reading", startTime: "", endTime: "", plannedDuration: 30, outcome: "Completed", actualDuration: 25, isAwaitingOutcome: false }], createdAt: "", isActive: true }, false)).toHaveLength(3);
    expect(adaptiveEstimateKey("Reading", 60)).toEqual(["studyflow/adaptive-estimate", "Reading", 60]);
  });

  it("applies themes directly when transitions are supported", () => {
    const setTheme = vi.fn();
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: query.includes("color-scheme"), media: query })));
    const transition = vi.fn((callback: () => void) => callback());
    Object.defineProperty(document, "startViewTransition", { value: transition, configurable: true });
    applyThemeWithTransition("system", setTheme);
    expect(setTheme).toHaveBeenCalledWith("system");
    expect(document.documentElement.dataset.theme).toBe("dark");
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: query.includes("prefers-color-scheme"), media: query })));
    applyThemeWithTransition("system", setTheme);
    expect(document.documentElement.dataset.theme).toBe("dark");
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: false, media: query })));
    applyThemeWithTransition("system", setTheme);
    expect(document.documentElement.dataset.theme).toBe("light");
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    applyThemeWithTransition("light", setTheme);
    expect(document.documentElement.style.colorScheme).toBe("light");
    applyThemeWithTransition("amoled", setTheme);
    expect(document.documentElement.classList.contains("amoled")).toBe(true);
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    applyThemeWithTransition("light", setTheme);
    expect(setTheme).toHaveBeenLastCalledWith("light");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    applyThemeWithTransition("dark", setTheme);
    expect(setTheme).toHaveBeenLastCalledWith("dark");
    const originalDocument = document;
    vi.stubGlobal("document", undefined);
    applyThemeWithTransition("light", setTheme);
    vi.stubGlobal("document", originalDocument);
    expect(setTheme).toHaveBeenLastCalledWith("light");
  });

  it("resolves adaptive and outcome contracts", () => {
    const estimate = {
      category: "reading" as const,
      original_minutes: 60,
      adaptive_minutes: 120,
      planned_minutes: 120,
      correction_factor: "2",
      history_scope: "category" as const,
      history_count: 3,
      planned_source: "adaptive" as const,
      available: true,
      acknowledgment_required: true,
    };
    expect(resolveEstimateSelection(60, null, "adaptive").plannedSource).toBe("Original");
    expect(resolveEstimateSelection(60, estimate ? toAdaptiveEstimate(estimate) : null, "adaptive").plannedSource).toBe("Adaptive");
    expect(resolveEstimateChoiceAction(60, toAdaptiveEstimate(estimate), "adaptive")).toEqual({ type: "acknowledge" });
    expect(resolveEstimateChoiceAction(60, null, "adaptive")).toMatchObject({ type: "select" });
    expect(resolvePreviewSelection(60, null, "Adaptive", false)).toEqual({ originalEstimate: 60, plannedSource: "Adaptive" });
    expect(resolvePreviewSelection(60, toAdaptiveEstimate(estimate), "Original", true).plannedSource).toBe("Original");
    expect(toAdaptiveEstimate({ ...estimate, acknowledgment_required: false })?.needsAcknowledgment).toBe(false);
    expect(toAdaptiveEstimate({ ...estimate, available: false })).toBeNull();
    expect(toAdaptiveEstimate({ ...estimate, correction_factor: "bad" })).toBeNull();

    expect(withLargeActualConfirmation({ outcome: "Completed", actualMinutes: 10 })).toMatchObject({ largeActualConfirmed: true });
    expect(toWireOutcome({ outcome: "Completed", actualMinutes: 10 }, false)).toEqual({ outcome: "completed", actual_minutes: 10, large_actual_confirmed: false });
    expect(toWireOutcome({ outcome: "Delayed", actualMinutes: 10, revisedRemainingMinutes: 20 }, true)).toMatchObject({ outcome: "delayed", remaining_minutes: 20 });
    expect(toWireOutcome({ outcome: "Missed", actualMinutes: 0 }, false)).toEqual({ outcome: "missed" });
    expect(() => toWireOutcome({ outcome: "Delayed", actualMinutes: 10 }, false)).toThrow();
    expect(isPositiveWholeMinute(" 15 ")).toBe(true);
    expect(isPositiveWholeMinute("1.5")).toBe(false);
    expect(outcomeSuccessCopy("Completed", null)).toContain("finished");
    expect(outcomeSuccessCopy("Delayed", null)).toContain("progress");
    expect(validateRegistration({ name: "a".repeat(201), password: "a".repeat(129), confirm: "" })).toMatchObject({ name: expect.any(String), password: expect.any(String), confirm: expect.any(String) });
  });

  it("formats durations across each boundary", () => {
    expect(formatDuration(30.4)).toBe("30m");
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(90)).toBe("1h 30m");
    expect(formatDurationLong(30)).toBe("30 min");
    expect(formatDurationLong(60)).toBe("1 hr");
    expect(formatDurationLong(90)).toBe("1 hr 30 min");
  });
});
