import type { AcademicTask } from "@/types/task";
import type { StudySession } from "@/types/session";

export type ReminderKind = "plan" | "outcome" | "overdue";

export interface Reminder {
  /** Stable across reloads, so "seen" survives a refresh. */
  id: string;
  kind: ReminderKind;
  title: string;
  detail: string;
  href: string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "5m", "3h", "2 days": short enough for a one-line reminder. */
export function elapsed(fromIso: string, now: number): string {
  const ms = Math.max(0, now - new Date(fromIso).getTime());
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MINUTE))}m`;
  if (ms < DAY) return `${Math.round(ms / HOUR)}h`;
  const days = Math.round(ms / DAY);
  return `${days} ${days === 1 ? "day" : "days"}`;
}

export function buildReminders({
  revisionId,
  sessions,
  tasks,
  now,
}: {
  revisionId: string | null;
  sessions: StudySession[];
  tasks: AcademicTask[];
  now: number;
}): Reminder[] {
  const reminders: Reminder[] = [];
  if (revisionId) {
    reminders.push({
      id: `plan:${revisionId}`,
      kind: "plan",
      title: "A new plan is ready to review",
      detail: "Accept or reject the changed study sessions.",
      href: "/calendar",
    });
  }
  sessions
    .filter((session) => session.isAwaitingOutcome)
    .sort((a, b) => b.endTime.localeCompare(a.endTime))
    .forEach((session) => reminders.push({
      id: `outcome:${session.id}`,
      kind: "outcome",
      title: `How did “${session.taskTitle}” go?`,
      detail: `Session ended ${elapsed(session.endTime, now)} ago. Record what you got done.`,
      href: "/calendar",
    }));
  tasks
    .filter((task) => task.status === "Overdue")
    .sort((a, b) => a.deadline.localeCompare(b.deadline))
    .forEach((task) => reminders.push({
      id: `overdue:${task.id}`,
      kind: "overdue",
      title: `${task.title} is overdue`,
      detail: `Due ${elapsed(task.deadline, now)} ago. Finish it or move the date.`,
      href: `/tasks/${task.id}`,
    }));
  return reminders;
}

const SEEN_KEY = "studyflow:reminders-seen";
const EMPTY: ReadonlySet<string> = new Set();
let cachedRaw: string | null = null;
let cachedSet: ReadonlySet<string> = EMPTY;
let memory: string | null = null;
const listeners = new Set<() => void>();

function readRaw(): string | null {
  if (memory !== null) return memory;
  try {
    return window.localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

/** Snapshot for `useSyncExternalStore`: the same Set until the stored list changes. */
export function seenReminders(): ReadonlySet<string> {
  const raw = readRaw();
  if (raw === cachedRaw) return cachedSet;
  cachedRaw = raw;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cachedSet = Array.isArray(parsed) ? new Set(parsed.filter((id): id is string => typeof id === "string")) : EMPTY;
  } catch {
    cachedSet = EMPTY;
  }
  return cachedSet;
}

export const noSeenReminders = (): ReadonlySet<string> => EMPTY;

export function subscribeToSeenReminders(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Stores exactly the current ids, so resolved reminders drop out of storage
 * and the same task going overdue again later counts as new.
 */
export function markRemindersSeen(ids: string[]): void {
  memory = JSON.stringify([...new Set(ids)].sort());
  try {
    window.localStorage.setItem(SEEN_KEY, memory);
  } catch {
    // The in-memory copy still clears the dot for this visit.
  }
  listeners.forEach((listener) => listener());
}

/** Forget every seen reminder, in memory and in storage, and tell subscribers. */
export function resetSeenReminders(): void {
  memory = null;
  cachedRaw = null;
  cachedSet = EMPTY;
  try {
    window.localStorage.removeItem(SEEN_KEY);
  } catch {
    // Nothing stored.
  }
  listeners.forEach((listener) => listener());
}
