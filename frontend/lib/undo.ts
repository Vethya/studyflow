"use client";

import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { setRequestKeepalive } from "@/lib/api/client";
import type { AcademicTask } from "@/types/task";

/**
 * Undo for actions the API cannot reverse (deleting a task, finishing one
 * early).
 *
 * The change is shown immediately, everywhere, through a task overlay; the
 * request itself waits out a short grace period. "Undo" inside that window
 * drops the request, so nothing ever has to be restored on the server.
 */
export const UNDO_WINDOW_MS = 5000;

/** Long enough for every mounted list to revalidate after the commit. */
const PATCH_SETTLE_MS = 4000;

type TaskOverlay = { removed: true } | { removed?: false; patch: Partial<AcademicTask> };

interface PendingAction {
  timer: ReturnType<typeof setTimeout>;
  run: () => Promise<void>;
}

const pending = new Map<string, PendingAction>();
/** Commits already sent, whether by their timer or by a flush. */
const inFlight = new Set<Promise<void>>();
const overlays = new Map<string, TaskOverlay>();
const listeners = new Set<() => void>();
let version = 0;
let unloadGuard = false;

function emit() {
  version += 1;
  for (const listener of listeners) listener();
}

function setOverlay(taskId: string, overlay: TaskOverlay | null) {
  if (overlay) overlays.set(taskId, overlay);
  else overlays.delete(taskId);
  emit();
}

function guardUnload() {
  if (unloadGuard) return;
  unloadGuard = true;
  // Closing the tab inside the window still carries out what was asked. A
  // plain fetch is cancelled as the page goes away, so these use keepalive.
  window.addEventListener("pagehide", () => {
    setRequestKeepalive(true);
    void flushPendingActions();
  });
  // Restored from the back/forward cache: the page lives on.
  window.addEventListener("pageshow", () => setRequestKeepalive(false));
}

export interface UndoableAction {
  /** One pending action per key; scheduling the same key again replaces it. */
  key: string;
  message: string;
  description?: string;
  commit: () => Promise<void>;
  /** How every view should show the task until the commit lands. */
  overlay?: { taskId: string } & ({ removed: true } | { patch: Partial<AcademicTask> });
  onUndo?: () => void;
  onCommitted?: () => void;
  /** Return the message to show; defaults to the error's own text. */
  onError?: (cause: unknown) => string | void;
}

export function scheduleUndoable(action: UndoableAction) {
  const existing = pending.get(action.key);
  if (existing) clearTimeout(existing.timer);

  const { overlay } = action;
  const shown: TaskOverlay | null = overlay
    ? "removed" in overlay ? { removed: true } : { patch: overlay.patch }
    : null;
  if (overlay && shown) setOverlay(overlay.taskId, shown);
  /** Clears this action's overlay, never a newer one on the same task. */
  const clearOwnOverlay = () => {
    if (overlay && overlays.get(overlay.taskId) === shown) setOverlay(overlay.taskId, null);
  };

  const commitAndReport = async () => {
    try {
      await action.commit();
      if (overlay && !("removed" in overlay)) setTimeout(clearOwnOverlay, PATCH_SETTLE_MS);
      action.onCommitted?.();
    } catch (cause) {
      clearOwnOverlay();
      const message = action.onError?.(cause);
      toast.error(message || (cause instanceof Error ? cause.message : "Something went wrong. Please try again."));
    }
  };

  const run = () => {
    pending.delete(action.key);
    const settled = commitAndReport().finally(() => inFlight.delete(settled));
    inFlight.add(settled);
    return settled;
  };

  const undo = () => {
    const current = pending.get(action.key);
    if (!current) return;
    clearTimeout(current.timer);
    pending.delete(action.key);
    clearOwnOverlay();
    action.onUndo?.();
  };

  pending.set(action.key, { timer: setTimeout(() => void run(), UNDO_WINDOW_MS), run });
  guardUnload();

  toast.success(action.message, {
    id: action.key,
    description: action.description,
    duration: UNDO_WINDOW_MS,
    action: { label: "Undo", onClick: undo },
  });
}

/**
 * Commit everything still inside its undo window, now, and wait for every
 * commit already under way, including ones their timer started.
 */
export async function flushPendingActions() {
  const actions = [...pending.values()];
  for (const action of actions) clearTimeout(action.timer);
  for (const action of actions) void action.run();
  await Promise.all([...inFlight]);
}

export function hasPendingAction(key: string) {
  return pending.has(key);
}

/** Apply pending deletions and patches to a task list. */
export function applyTaskOverlays(tasks: AcademicTask[]): AcademicTask[] {
  if (overlays.size === 0) return tasks;
  const result: AcademicTask[] = [];
  for (const task of tasks) {
    const overlay = overlays.get(task.id);
    if (!overlay) result.push(task);
    else if (!overlay.removed) result.push({ ...task, ...overlay.patch });
  }
  return result;
}

export function isTaskRemoved(taskId: string) {
  return overlays.get(taskId)?.removed === true;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-render when any pending overlay changes; returns a change counter. */
export function useTaskOverlayVersion() {
  return useSyncExternalStore(subscribe, () => version, () => 0);
}

/**
 * Drop every pending action without sending it, for when the session ends
 * underneath them. Their requests would otherwise land on whichever account
 * signs in next.
 */
export function cancelPendingActions() {
  for (const [key, action] of pending) {
    clearTimeout(action.timer);
    toast.dismiss(key);
  }
  pending.clear();
  overlays.clear();
  emit();
}

/** Test helper: forget every pending action and overlay. */
export const resetUndoState = cancelPendingActions;
