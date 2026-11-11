// @vitest-environment jsdom
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AcademicTask } from "@/types/task";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));
const keepaliveMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/client", () => ({ setRequestKeepalive: keepaliveMock }));

import {
  applyTaskOverlays,
  cancelPendingActions,
  flushPendingActions,
  hasPendingAction,
  isTaskRemoved,
  resetUndoState,
  scheduleUndoable,
  UNDO_WINDOW_MS,
  useTaskOverlayVersion,
} from "./undo";

const task = (id: string) => ({ id, title: `Task ${id}`, status: "pending" }) as unknown as AcademicTask;

function lastUndo(): () => void {
  const options = toastMock.success.mock.calls.at(-1)?.[1] as { action: { onClick: () => void } };
  return options.action.onClick;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  resetUndoState();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("undo", () => {
  it("returns the task list untouched without overlays", () => {
    const tasks = [task("a")];
    expect(applyTaskOverlays(tasks)).toBe(tasks);
  });

  it("removes a task until committed, then calls onCommitted", async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    const onCommitted = vi.fn();
    scheduleUndoable({ key: "del-a", message: "Deleted", description: "Task A", commit, onCommitted, overlay: { taskId: "a", removed: true } });
    expect(toastMock.success).toHaveBeenCalledWith("Deleted", expect.objectContaining({ id: "del-a", description: "Task A", duration: UNDO_WINDOW_MS }));
    expect(hasPendingAction("del-a")).toBe(true);
    expect(isTaskRemoved("a")).toBe(true);
    expect(isTaskRemoved("b")).toBe(false);
    expect(applyTaskOverlays([task("a"), task("b")]).map((t) => t.id)).toEqual(["b"]);

    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(onCommitted).toHaveBeenCalled();
    expect(hasPendingAction("del-a")).toBe(false);
    // A removal overlay stays until the list revalidates without the task.
    expect(isTaskRemoved("a")).toBe(true);
  });

  it("patches a task and clears the patch after settling", async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    scheduleUndoable({ key: "done-a", message: "Done", commit, overlay: { taskId: "a", patch: { title: "Patched" } } });
    expect(applyTaskOverlays([task("a")])[0].title).toBe("Patched");
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
    expect(applyTaskOverlays([task("a")])[0].title).toBe("Patched");
    await vi.advanceTimersByTimeAsync(4000);
    expect(applyTaskOverlays([task("a")])[0].title).toBe("Task a");
  });

  it("commits without an overlay or callbacks", async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    scheduleUndoable({ key: "plain", message: "Saved", commit });
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
    expect(commit).toHaveBeenCalled();
  });

  it("undo drops the request and restores the task", async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    const onUndo = vi.fn();
    scheduleUndoable({ key: "del-a", message: "Deleted", commit, onUndo, overlay: { taskId: "a", removed: true } });
    const undo = lastUndo();
    undo();
    expect(onUndo).toHaveBeenCalled();
    expect(isTaskRemoved("a")).toBe(false);
    undo();
    expect(onUndo).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
    expect(commit).not.toHaveBeenCalled();

    scheduleUndoable({ key: "plain", message: "Saved", commit });
    lastUndo()();
    expect(hasPendingAction("plain")).toBe(false);
  });

  it("rescheduling the same key replaces the pending action", async () => {
    const first = vi.fn().mockResolvedValue(undefined);
    const second = vi.fn().mockResolvedValue(undefined);
    scheduleUndoable({ key: "k", message: "One", commit: first });
    scheduleUndoable({ key: "k", message: "Two", commit: second });
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("reports failures and restores the overlay", async () => {
    scheduleUndoable({ key: "a", message: "Deleted", commit: () => Promise.reject(new Error("Server down")), overlay: { taskId: "a", removed: true } });
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
    expect(toastMock.error).toHaveBeenLastCalledWith("Server down");
    expect(isTaskRemoved("a")).toBe(false);

    scheduleUndoable({ key: "b", message: "Saved", commit: () => Promise.reject("nope") });
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
    expect(toastMock.error).toHaveBeenLastCalledWith("Something went wrong. Please try again.");

    scheduleUndoable({ key: "c", message: "Saved", commit: () => Promise.reject(new Error("raw")), onError: () => "Custom message" });
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
    expect(toastMock.error).toHaveBeenLastCalledWith("Custom message");

    scheduleUndoable({ key: "d", message: "Saved", commit: () => Promise.reject(new Error("fallback")), onError: () => undefined });
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
    expect(toastMock.error).toHaveBeenLastCalledWith("fallback");
  });

  it("flushes pending actions immediately and on pagehide", async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    scheduleUndoable({ key: "a", message: "One", commit });
    scheduleUndoable({ key: "b", message: "Two", commit });
    await flushPendingActions();
    expect(commit).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
    expect(commit).toHaveBeenCalledTimes(2);

    scheduleUndoable({ key: "c", message: "Three", commit });
    window.dispatchEvent(new Event("pagehide"));
    // Sent with keepalive, so the request outlives the closing tab.
    expect(keepaliveMock).toHaveBeenLastCalledWith(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(commit).toHaveBeenCalledTimes(3);
    window.dispatchEvent(new Event("pageshow"));
    expect(keepaliveMock).toHaveBeenLastCalledWith(false);
  });

  it("flush waits for a commit its timer already started", async () => {
    let finish!: () => void;
    const commit = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const onCommitted = vi.fn();
    scheduleUndoable({ key: "a", message: "One", commit, onCommitted });
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(hasPendingAction("a")).toBe(false);

    let flushed = false;
    const flushing = flushPendingActions().then(() => { flushed = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(flushed).toBe(false);
    finish();
    await flushing;
    expect(onCommitted).toHaveBeenCalled();
    // Once settled, nothing is left for a later flush to wait on.
    await flushPendingActions();
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("never clears a newer overlay on the same task", async () => {
    scheduleUndoable({ key: "done-a", message: "Done", commit: vi.fn().mockResolvedValue(undefined), overlay: { taskId: "a", patch: { title: "First" } } });
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
    scheduleUndoable({ key: "del-a", message: "Deleted", commit: vi.fn().mockResolvedValue(undefined), overlay: { taskId: "a", removed: true } });
    // The first action's settle timer fires while the deletion is pending.
    await vi.advanceTimersByTimeAsync(4000);
    expect(isTaskRemoved("a")).toBe(true);
  });

  it("cancels pending actions without sending them when the session ends", async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    scheduleUndoable({ key: "a", message: "One", commit, overlay: { taskId: "a", removed: true } });
    cancelPendingActions();
    expect(toastMock.dismiss).toHaveBeenCalledWith("a");
    expect(isTaskRemoved("a")).toBe(false);
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
    expect(commit).not.toHaveBeenCalled();
  });

  it("resetUndoState clears pending timers", async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    scheduleUndoable({ key: "a", message: "One", commit, overlay: { taskId: "a", removed: true } });
    resetUndoState();
    expect(hasPendingAction("a")).toBe(false);
    expect(isTaskRemoved("a")).toBe(false);
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
    expect(commit).not.toHaveBeenCalled();
  });

  it("exposes an overlay version that re-renders subscribers", () => {
    const { result, unmount } = renderHook(() => useTaskOverlayVersion());
    const before = result.current;
    act(() => scheduleUndoable({ key: "a", message: "One", commit: vi.fn().mockResolvedValue(undefined), overlay: { taskId: "a", removed: true } }));
    expect(result.current).toBeGreaterThan(before);
    unmount();
    function Probe() { return createElement("span", null, useTaskOverlayVersion()); }
    expect(renderToString(createElement(Probe))).toContain("0");
  });
});
