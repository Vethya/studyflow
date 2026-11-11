// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FOCUS_TIMER_STORAGE_KEY, getFocusTimerState, resetFocusTimerStore, DEFAULT_FOCUS_SETTINGS } from "@/lib/focus-timer";

type Load = (signal: AbortSignal) => unknown;

const mocks = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
  listTasks: vi.fn(),
  tasks: { current: { data: null as unknown, isLoading: false } },
  lastLoad: { current: null as Load | null },
  supported: { current: true },
  permission: { current: true },
  primeChime: vi.fn(),
  playChime: vi.fn(),
  showPhaseNotification: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/lib/api", () => ({ tasks: { listTasks: mocks.listTasks } }));
vi.mock("@/hooks/use-api", () => ({
  useApi: (_key: unknown, load: Load) => {
    mocks.lastLoad.current = load;
    return mocks.tasks.current;
  },
}));
vi.mock("@/lib/focus-timer-alerts", () => ({
  primeChime: mocks.primeChime,
  playChime: mocks.playChime,
  showPhaseNotification: mocks.showPhaseNotification,
  notificationsSupported: () => mocks.supported.current,
  requestNotificationPermission: () => Promise.resolve(mocks.permission.current),
}));

import { FocusTimer, toggleFocusTimer } from "./focus-timer";

const task = (id: string, title: string, status = "Not Started") => ({ id, title, status });

function preset(value: Record<string, unknown>) {
  window.localStorage.setItem(FOCUS_TIMER_STORAGE_KEY, JSON.stringify(value));
  resetFocusTimerStore();
}

const trigger = () => screen.getByRole("button", { name: /^Focus timer/ });
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

function openPanel() {
  fireEvent.click(trigger());
  return screen.getByText("Focus timer", { selector: "h2" });
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2099-01-01T09:00:00Z") });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  window.localStorage.clear();
  resetFocusTimerStore();
  document.title = "Dashboard — StudyFlow";
  mocks.tasks.current = { data: null, isLoading: false };
  mocks.supported.current = true;
  mocks.permission.current = true;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("FocusTimer", () => {
  it("starts, ticks, pauses, resumes and resets with a live title and announcements", () => {
    render(<FocusTimer />);
    expect(trigger().getAttribute("aria-label")).toBe("Focus timer");
    expect(screen.queryByTestId("focus-timer-pill")).toBeNull();

    openPanel();
    expect(screen.getByRole("timer", { name: "Focus, 25:00 left" })).toBeTruthy();
    expect(screen.getByText("Round 1 of 4")).toBeTruthy();
    expect(screen.getByRole("img", { name: "0 of 4 focus rounds done" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Start focus" }));
    expect(mocks.primeChime).toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("Focus started.");
    advance(0);
    expect(screen.getByTestId("focus-timer-pill").textContent).toBe("25:00");
    expect(document.title).toBe("25:00 · Focus — StudyFlow");

    advance(61_000);
    expect(screen.getByTestId("focus-timer-pill").textContent).toBe("23:59");
    expect(trigger().getAttribute("aria-label")).toBe("Focus timer: Focus, 23:59 left");
    expect(document.title).toBe("23:59 · Focus — StudyFlow");
    expect(Number(screen.getByTestId("focus-timer-ring").getAttribute("stroke-dashoffset"))).toBeLessThan(2 * Math.PI * 76);

    // A page navigation replaces the title; that new one is restored later.
    document.title = "Tasks — StudyFlow";
    advance(1000);
    expect(document.title).toBe("23:58 · Focus — StudyFlow");

    fireEvent.click(screen.getByRole("button", { name: "Pause focus" }));
    expect(screen.getByRole("status").textContent).toBe("Focus paused.");
    expect(document.title).toBe("Tasks — StudyFlow");
    expect(trigger().getAttribute("aria-label")).toBe("Focus timer: Focus, 23:58 left, paused");
    advance(10_000);
    expect(screen.getByTestId("focus-timer-pill").textContent).toBe("23:58");

    fireEvent.click(screen.getByRole("button", { name: "Resume focus" }));
    advance(2000);
    expect(screen.getByTestId("focus-timer-pill").textContent).toBe("23:56");

    fireEvent.click(screen.getByRole("button", { name: "Reset timer" }));
    expect(screen.queryByTestId("focus-timer-pill")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Focus is ready to start.");
    expect(getFocusTimerState().status).toBe("idle");
  });

  it("chimes, toasts and offers to start the break when a focus round ends", () => {
    preset({ settings: { ...DEFAULT_FOCUS_SETTINGS, focusMinutes: 1 } });
    render(<FocusTimer />);
    act(() => toggleFocusTimer());
    advance(59_000);
    expect(mocks.toast).not.toHaveBeenCalled();
    advance(1000);
    expect(mocks.playChime).toHaveBeenCalledTimes(1);
    expect(mocks.showPhaseNotification).not.toHaveBeenCalled();
    const [title, options] = mocks.toast.mock.calls[0];
    expect(title).toBe("Focus round done");
    expect(options.description).toBe("Time for a 5-minute break.");
    expect(options.action.label).toBe("Start break");
    expect(screen.getByRole("status").textContent).toBe("Short break is ready to start.");
    expect(document.title).toBe("Dashboard — StudyFlow");

    act(() => options.action.onClick());
    advance(0);
    expect(screen.getByTestId("focus-timer-pill").className).toContain("text-surplus");
    openPanel();
    expect(screen.getByRole("img", { name: "1 of 4 focus rounds done" })).toBeTruthy();
    advance(5 * 60_000);
    const [breakTitle, breakOptions] = mocks.toast.mock.calls[1];
    expect(breakTitle).toBe("Break over");
    expect(breakOptions.description).toBe("Ready for focus round 2.");
    expect(breakOptions.action.label).toBe("Start focus");
  });

  it("auto-starts a long break, notifies and stays quiet when sound is off", () => {
    preset({ round: 4, settings: { ...DEFAULT_FOCUS_SETTINGS, focusMinutes: 1, autoStart: true, sound: false, notifications: true } });
    render(<FocusTimer />);
    act(() => toggleFocusTimer());
    advance(60_000);
    expect(mocks.playChime).not.toHaveBeenCalled();
    expect(mocks.showPhaseNotification).toHaveBeenCalledWith("Focus round done", "Time for a 15-minute long break.");
    expect(mocks.toast.mock.calls[0][1].action).toBeUndefined();
    expect(getFocusTimerState()).toMatchObject({ phase: "longBreak", status: "running" });
    advance(0);
    expect(document.title).toBe("15:00 · Long break — StudyFlow");
  });

  it("catches up when a sleeping tab becomes visible and leaves a foreign title alone", () => {
    document.title = "01:00 · Focus — StudyFlow";
    preset({ status: "running", endsAt: Date.now() + 90_000 });
    render(<FocusTimer />);
    advance(0);
    expect(document.title).toBe("01:30 · Focus — StudyFlow");
    vi.setSystemTime(Date.now() + 30_000);
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(screen.getByTestId("focus-timer-pill").textContent).toBe("01:00");
    act(() => toggleFocusTimer());
    expect(document.title).toBe("01:00 · Focus — StudyFlow");
    expect(screen.getByTestId("focus-timer-pill").className).toContain("bg-muted");
  });

  it("skips phases from the panel", () => {
    render(<FocusTimer />);
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Skip to next phase" }));
    expect(screen.getByRole("timer", { name: "Short break, 05:00 left" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start short break" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip to next phase" }));
    expect(getFocusTimerState()).toMatchObject({ phase: "focus", round: 2, status: "running" });
  });

  it("picks one of the open tasks to focus on", () => {
    mocks.tasks.current = { data: [task("t1", "Essay"), task("t2", "Done already", "Completed"), task("t3", "Lab report", "In Progress")], isLoading: false };
    render(<FocusTimer />);
    openPanel();
    const signal = new AbortController().signal;
    mocks.lastLoad.current?.(signal);
    expect(mocks.listTasks).toHaveBeenCalledWith({}, signal);

    const picker = screen.getByLabelText("Focusing on") as HTMLSelectElement;
    expect(Array.from(picker.options).map((option) => option.text)).toEqual(["Nothing in particular", "Essay", "Lab report"]);
    fireEvent.change(picker, { target: { value: "t3" } });
    expect(getFocusTimerState()).toMatchObject({ taskId: "t3", taskTitle: "Lab report" });
    fireEvent.change(picker, { target: { value: "" } });
    expect(getFocusTimerState()).toMatchObject({ taskId: null, taskTitle: null });
  });

  it("keeps showing a chosen task that is no longer open and reports loading", () => {
    mocks.tasks.current = { data: null, isLoading: true };
    preset({ taskId: "gone", taskTitle: "Old essay" });
    const view = render(<FocusTimer />);
    openPanel();
    expect(screen.getByText("Loading your tasks…")).toBeTruthy();
    expect((screen.getByLabelText("Focusing on") as HTMLSelectElement).selectedOptions[0].text).toBe("Old essay");
    view.unmount();

    preset({ taskId: "gone" });
    render(<FocusTimer />);
    openPanel();
    expect((screen.getByLabelText("Focusing on") as HTMLSelectElement).selectedOptions[0].text).toBe("Earlier task");
  });

  it("edits and persists settings", async () => {
    render(<FocusTimer />);
    openPanel();
    const toggle = screen.getByRole("button", { name: "Timer settings" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    const focus = screen.getByLabelText("Focus (min)") as HTMLInputElement;
    fireEvent.change(focus, { target: { value: "30" } });
    expect(screen.getByRole("timer", { name: "Focus, 30:00 left" })).toBeTruthy();
    fireEvent.change(focus, { target: { value: "" } });
    expect(getFocusTimerState().settings.focusMinutes).toBe(30);
    expect(focus.value).toBe("");
    fireEvent.blur(focus);
    expect(focus.value).toBe("30");
    fireEvent.change(focus, { target: { value: "999" } });
    expect(focus.value).toBe("180");
    fireEvent.change(screen.getByLabelText("Rounds before long break"), { target: { value: "2" } });
    expect(screen.getByText("Round 1 of 2")).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem(FOCUS_TIMER_STORAGE_KEY)!).settings).toMatchObject({ focusMinutes: 180, roundsBeforeLongBreak: 2 });

    fireEvent.click(screen.getByRole("switch", { name: "Start the next phase automatically" }));
    expect(getFocusTimerState().settings.autoStart).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: "Play a chime when a phase ends" }));
    expect(getFocusTimerState().settings.sound).toBe(false);

    const notify = screen.getByRole("switch", { name: "Notify me when the tab is in the background" });
    mocks.permission.current = false;
    await act(async () => { fireEvent.click(notify); });
    expect(mocks.toast.error).toHaveBeenCalledWith("Notifications are blocked", expect.any(Object));
    expect(getFocusTimerState().settings.notifications).toBe(false);
    mocks.permission.current = true;
    await act(async () => { fireEvent.click(notify); });
    expect(getFocusTimerState().settings.notifications).toBe(true);
    await act(async () => { fireEvent.click(notify); });
    expect(getFocusTimerState().settings.notifications).toBe(false);

    fireEvent.click(toggle);
    expect(screen.queryByLabelText("Focus (min)")).toBeNull();
  });

  it("hides the notification setting when the browser has none", () => {
    mocks.supported.current = false;
    render(<FocusTimer />);
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Timer settings" }));
    expect(screen.queryByRole("switch", { name: /Notify me/ })).toBeNull();
  });
});
