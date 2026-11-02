// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  completePhase,
  DEFAULT_FOCUS_SETTINGS,
  DEFAULT_FOCUS_STATE,
  FOCUS_TIMER_STORAGE_KEY,
  formatClock,
  getFocusTimerState,
  getServerFocusTimerState,
  isPhaseOver,
  nextPhase,
  parseFocusState,
  pauseTimer,
  phaseDurationMs,
  phaseProgress,
  remainingMs,
  resetFocusTimerStore,
  resetTimer,
  setFocusTask,
  skipPhase,
  startTimer,
  subscribeToFocusTimer,
  updateFocusTimer,
  updateSettings,
  type FocusTimerState,
} from "./focus-timer";

const MIN = 60_000;
const state = (overrides: Partial<FocusTimerState> = {}): FocusTimerState => ({ ...DEFAULT_FOCUS_STATE, ...overrides });

describe("durations and remaining time", () => {
  it("uses each phase's length", () => {
    expect(phaseDurationMs("focus", DEFAULT_FOCUS_SETTINGS)).toBe(25 * MIN);
    expect(phaseDurationMs("shortBreak", DEFAULT_FOCUS_SETTINGS)).toBe(5 * MIN);
    expect(phaseDurationMs("longBreak", DEFAULT_FOCUS_SETTINGS)).toBe(15 * MIN);
  });

  it("derives remaining time from the end timestamp, the paused value or the full phase", () => {
    expect(remainingMs(state({ status: "running", endsAt: 10_000 }), 4_000)).toBe(6_000);
    expect(remainingMs(state({ status: "running", endsAt: 10_000 }), 99_000)).toBe(0);
    expect(remainingMs(state({ status: "paused", pausedRemainingMs: 1234 }), 0)).toBe(1234);
    expect(remainingMs(state(), 0)).toBe(25 * MIN);
    expect(remainingMs(state({ status: "running", endsAt: null }), 0)).toBe(25 * MIN);
    expect(remainingMs(state({ status: "paused", pausedRemainingMs: null }), 0)).toBe(25 * MIN);
  });

  it("reports progress and when a phase is over", () => {
    const running = state({ status: "running", endsAt: 25 * MIN });
    expect(phaseProgress(running, 0)).toBe(0);
    expect(phaseProgress(running, 12.5 * MIN)).toBe(0.5);
    expect(phaseProgress(running, 30 * MIN)).toBe(1);
    expect(phaseProgress(state({ status: "paused", pausedRemainingMs: 99 * MIN }), 0)).toBe(0);
    expect(isPhaseOver(running, 25 * MIN)).toBe(true);
    expect(isPhaseOver(running, 1)).toBe(false);
    expect(isPhaseOver(state(), 99 * MIN)).toBe(false);
    expect(isPhaseOver(state({ status: "running", endsAt: null }), 1)).toBe(false);
  });

  it("formats a clock, rounding up partial seconds", () => {
    expect(formatClock(25 * MIN)).toBe("25:00");
    expect(formatClock(61_001)).toBe("01:02");
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(-5)).toBe("00:00");
    expect(formatClock(125 * MIN)).toBe("125:00");
  });
});

describe("controls", () => {
  it("starts, pauses and resumes", () => {
    const running = startTimer(state(), 1000);
    expect(running).toMatchObject({ status: "running", endsAt: 1000 + 25 * MIN, pausedRemainingMs: null });
    expect(startTimer(running, 5000)).toBe(running);
    const paused = pauseTimer(running, 1000 + MIN);
    expect(paused).toMatchObject({ status: "paused", endsAt: null, pausedRemainingMs: 24 * MIN });
    expect(pauseTimer(paused, 0)).toBe(paused);
    expect(startTimer(paused, 10_000)).toMatchObject({ status: "running", endsAt: 10_000 + 24 * MIN });
  });

  it("resets to the first focus round but keeps settings and task", () => {
    const settings = { ...DEFAULT_FOCUS_SETTINGS, focusMinutes: 50 };
    const reset = resetTimer(state({ phase: "longBreak", round: 4, status: "paused", pausedRemainingMs: 5, taskId: "t", taskTitle: "T", settings }));
    expect(reset).toEqual({ ...DEFAULT_FOCUS_STATE, taskId: "t", taskTitle: "T", settings });
  });

  it("alternates focus and breaks, with a long break after the last round", () => {
    expect(nextPhase(state({ round: 1 }))).toEqual({ phase: "shortBreak", round: 1 });
    expect(nextPhase(state({ round: 4 }))).toEqual({ phase: "longBreak", round: 4 });
    expect(nextPhase(state({ phase: "shortBreak", round: 2 }))).toEqual({ phase: "focus", round: 3 });
    expect(nextPhase(state({ phase: "shortBreak", round: 4 }))).toEqual({ phase: "focus", round: 4 });
    expect(nextPhase(state({ phase: "longBreak", round: 4 }))).toEqual({ phase: "focus", round: 1 });
  });

  it("completes a phase, auto-starting only when enabled", () => {
    const running = state({ status: "running", endsAt: 100 });
    expect(completePhase(running, 100)).toMatchObject({ phase: "shortBreak", status: "idle", endsAt: null });
    const auto = state({ status: "running", endsAt: 100, settings: { ...DEFAULT_FOCUS_SETTINGS, autoStart: true } });
    expect(completePhase(auto, 100)).toMatchObject({ phase: "shortBreak", status: "running", endsAt: 100 + 5 * MIN });
  });

  it("skips, keeping a running timer running", () => {
    expect(skipPhase(state({ status: "running", endsAt: 9 }), 50)).toMatchObject({ phase: "shortBreak", status: "running", endsAt: 50 + 5 * MIN });
    expect(skipPhase(state({ status: "paused", pausedRemainingMs: 9 }), 50)).toMatchObject({ phase: "shortBreak", status: "idle", pausedRemainingMs: null });
  });

  it("clamps settings and keeps the round within the cycle", () => {
    const next = updateSettings(state({ round: 4 }), { focusMinutes: 0, longBreakMinutes: 500.4, roundsBeforeLongBreak: 2, shortBreakMinutes: Number.NaN, sound: false });
    expect(next.settings).toEqual({ ...DEFAULT_FOCUS_SETTINGS, focusMinutes: 1, longBreakMinutes: 90, roundsBeforeLongBreak: 2, sound: false });
    expect(next.round).toBe(2);
    expect(updateSettings(state(), { focusMinutes: "x" as unknown as number }).settings.focusMinutes).toBe(25);
  });

  it("sets and clears the focus task", () => {
    const withTask = setFocusTask(state(), { id: "t1", title: "Essay" });
    expect(withTask).toMatchObject({ taskId: "t1", taskTitle: "Essay" });
    expect(setFocusTask(withTask, null)).toMatchObject({ taskId: null, taskTitle: null });
  });
});

describe("parseFocusState", () => {
  it("falls back for missing or malformed input", () => {
    expect(parseFocusState(null)).toBe(DEFAULT_FOCUS_STATE);
    expect(parseFocusState("{oops")).toBe(DEFAULT_FOCUS_STATE);
    expect(parseFocusState("null")).toBe(DEFAULT_FOCUS_STATE);
    expect(parseFocusState("5")).toBe(DEFAULT_FOCUS_STATE);
    expect(parseFocusState("{}")).toEqual(DEFAULT_FOCUS_STATE);
    expect(parseFocusState(JSON.stringify({ phase: "nap", round: "two", settings: { sound: "yes", focusMinutes: 40 }, taskTitle: "orphan" }))).toEqual({
      ...DEFAULT_FOCUS_STATE,
      settings: { ...DEFAULT_FOCUS_SETTINGS, focusMinutes: 40 },
    });
  });

  it("restores running and paused timers", () => {
    const running = { ...DEFAULT_FOCUS_STATE, phase: "longBreak", status: "running", endsAt: 123, round: 9, taskId: "t1", taskTitle: "Essay" };
    expect(parseFocusState(JSON.stringify(running))).toEqual({ ...running, round: 4 });
    expect(parseFocusState(JSON.stringify({ status: "running" })).status).toBe("idle");
    expect(parseFocusState(JSON.stringify({ status: "paused", pausedRemainingMs: 500, round: 0 }))).toMatchObject({ status: "paused", pausedRemainingMs: 500, round: 1 });
    expect(parseFocusState(JSON.stringify({ status: "paused", pausedRemainingMs: -1 })).status).toBe("idle");
    expect(parseFocusState(JSON.stringify({ taskId: "t1" }))).toMatchObject({ taskId: "t1", taskTitle: null });
  });
});

describe("store", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetFocusTimerStore();
  });
  afterEach(() => vi.restoreAllMocks());

  it("loads from storage, persists updates and notifies subscribers", () => {
    window.localStorage.setItem(FOCUS_TIMER_STORAGE_KEY, JSON.stringify({ phase: "shortBreak" }));
    expect(getFocusTimerState().phase).toBe("shortBreak");
    expect(getServerFocusTimerState()).toBe(DEFAULT_FOCUS_STATE);

    const listener = vi.fn();
    const unsubscribe = subscribeToFocusTimer(listener);
    const next = updateFocusTimer((current) => startTimer(current, 0));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(JSON.parse(window.localStorage.getItem(FOCUS_TIMER_STORAGE_KEY)!).endsAt).toBe(5 * MIN);
    expect(updateFocusTimer((current) => current)).toBe(next);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("follows other tabs through storage events", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToFocusTimer(listener);
    const second = subscribeToFocusTimer(vi.fn());
    expect(getFocusTimerState().phase).toBe("focus");

    window.localStorage.setItem(FOCUS_TIMER_STORAGE_KEY, JSON.stringify({ phase: "longBreak" }));
    window.dispatchEvent(new StorageEvent("storage", { key: "other" }));
    expect(listener).not.toHaveBeenCalled();
    window.dispatchEvent(new StorageEvent("storage", { key: FOCUS_TIMER_STORAGE_KEY }));
    expect(getFocusTimerState().phase).toBe("longBreak");
    window.localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(getFocusTimerState().phase).toBe("focus");
    expect(listener).toHaveBeenCalledTimes(2);

    second();
    unsubscribe();
    window.dispatchEvent(new StorageEvent("storage", { key: FOCUS_TIMER_STORAGE_KEY }));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("keeps working in memory when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(getFocusTimerState()).toBe(DEFAULT_FOCUS_STATE);
    expect(updateFocusTimer((current) => startTimer(current, 0)).status).toBe("running");
    expect(getFocusTimerState().status).toBe("running");
  });
});
