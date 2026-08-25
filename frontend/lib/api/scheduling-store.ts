/**
 * Browser-side stand-in for the scheduling backend.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS IS TEMPORARY — delete it together with `lib/mock-scheduler.ts` once
 * `lib/api/scheduling.ts` calls real endpoints. Nothing outside that file
 * should ever import this module.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * State lives in `localStorage` so that accepting a schedule, recording an
 * outcome and reloading behave the way they will against a real server. It is
 * namespaced per account so two students on one browser cannot see each
 * other's plan — the same isolation the backend enforces (SPEC §18.3).
 */

import { runMockScheduler } from "@/lib/mock-scheduler";
import { account as accountApi, availability as availabilityApi, tasks as tasksApi } from ".";
import { ApiError } from "./client";
import type { OutcomeFormData, StudySession } from "@/types/session";
import type { Schedule, ScheduleProposal, ScheduleRevision } from "@/types/schedule";
import type { AdaptiveEstimate, EffortProgress, WeeklyProgress } from "@/types/progress";
import type { AcademicTask, Category } from "@/types/task";

const KEY = "studyflow.mock-scheduling.v1";
/** Mimics server latency so loading states are actually exercised. */
const LATENCY_MS = 180;

interface PersistedState {
  activeSchedule: Schedule | null;
  pendingProposal: ScheduleProposal | null;
  pendingRevision: ScheduleRevision | null;
  /** Outcomes recorded against session ids. */
  outcomes: Record<string, { outcome: string; actualMinutes: number; revised?: number }>;
  /** Extra remaining minutes produced by Delayed outcomes, per task. */
  revisedRemaining: Record<string, number>;
  acknowledgedCategories: string[];
  counter: number;
}

const EMPTY: PersistedState = {
  activeSchedule: null,
  pendingProposal: null,
  pendingRevision: null,
  outcomes: {},
  revisedRemaining: {},
  acknowledgedCategories: [],
  counter: 0,
};

function read(): PersistedState {
  if (typeof window === "undefined") return { ...EMPTY };
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as PersistedState) } : { ...EMPTY };
  } catch {
    return { ...EMPTY };
  }
}

function write(state: PersistedState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // A full or unavailable store is not worth failing the request over.
  }
}

function delay<T>(value: T, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(value), LATENCY_MS);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

/** Everything the scheduler needs, fetched from the endpoints that do exist. */
async function loadInputs(signal?: AbortSignal) {
  const [tasks, windows, periods, preferences] = await Promise.all([
    tasksApi.listTasks({}, signal),
    availabilityApi.listWindows(signal),
    availabilityApi.listUnavailablePeriods(signal),
    accountApi.getPreferences(signal),
  ]);
  return {
    tasks,
    windows,
    periods,
    preferredSessionLength: preferences.preferred_session_length_minutes ?? 60,
    minimumBreak: preferences.minimum_break_minutes ?? 10,
  };
}

/** Applies Delayed revisions on top of the task's own remaining minutes. */
function withRevisedRemaining(tasks: AcademicTask[], state: PersistedState): AcademicTask[] {
  return tasks.map((task) => {
    const revised = state.revisedRemaining[task.id];
    return revised === undefined ? task : { ...task, remainingDuration: revised };
  });
}

/** Marks past sessions with no recorded outcome as Awaiting Outcome (§12.1). */
function markAwaiting(sessions: StudySession[], now = new Date()): StudySession[] {
  return sessions.map((session) =>
    session.outcome === undefined && new Date(session.endTime) < now
      ? { ...session, isAwaitingOutcome: true }
      : session,
  );
}

// ─── Sessions ───────────────────────────────────────────────────
export async function listSessions(signal?: AbortSignal): Promise<StudySession[]> {
  const state = read();
  const sessions = state.activeSchedule?.sessions ?? [];
  return delay(markAwaiting(sessions), signal);
}

export async function getSession(sessionId: string, signal?: AbortSignal) {
  const found = (await listSessions(signal)).find((session) => session.id === sessionId);
  if (!found) throw new ApiError(404, "That study session no longer exists.");
  return found;
}

// ─── Schedule ───────────────────────────────────────────────────
export async function getActiveSchedule(signal?: AbortSignal): Promise<Schedule | null> {
  const state = read();
  if (!state.activeSchedule) return delay(null, signal);
  return delay(
    { ...state.activeSchedule, sessions: markAwaiting(state.activeSchedule.sessions) },
    signal,
  );
}

export async function generateProposal(): Promise<ScheduleProposal> {
  const state = read();
  const inputs = await loadInputs();

  // Completed and Delayed sessions never move or reappear (SPEC §14.2).
  const settled = (state.activeSchedule?.sessions ?? []).filter(
    (session) => session.outcome === "Completed" || session.outcome === "Delayed",
  );

  const result = runMockScheduler({
    ...inputs,
    tasks: withRevisedRemaining(inputs.tasks, state),
    keepSessions: settled,
  });

  const proposal: ScheduleProposal = {
    id: `mock-proposal-${++state.counter}`,
    proposedSessions: [...settled, ...result.sessions],
    unscheduledWork: result.unscheduledWork,
    overloadWarnings: result.overloadWarnings,
    createdAt: new Date().toISOString(),
  };

  state.pendingProposal = proposal;
  write(state);
  return delay(proposal);
}

export async function acceptProposal(proposalId: string): Promise<Schedule> {
  const state = read();
  const proposal =
    state.pendingProposal?.id === proposalId
      ? state.pendingProposal
      : state.pendingRevision?.id === proposalId
        ? state.pendingRevision
        : null;

  if (!proposal) throw new ApiError(409, "That plan is no longer available. Generate a new one.");

  // Accepting replaces the active future schedule with the complete proposal.
  state.activeSchedule = {
    id: `mock-schedule-${++state.counter}`,
    sessions: proposal.proposedSessions,
    createdAt: new Date().toISOString(),
    isActive: true,
  };
  state.pendingProposal = null;
  state.pendingRevision = null;
  write(state);
  return delay(state.activeSchedule);
}

export async function rejectProposal(proposalId: string): Promise<void> {
  const state = read();
  // Rejecting leaves the active schedule untouched (SPEC §11.2, §14.4).
  if (state.pendingProposal?.id === proposalId) state.pendingProposal = null;
  if (state.pendingRevision?.id === proposalId) state.pendingRevision = null;
  write(state);
  return delay(undefined);
}

export async function getPendingRevision(signal?: AbortSignal): Promise<ScheduleRevision | null> {
  return delay(read().pendingRevision, signal);
}

// ─── Outcomes ───────────────────────────────────────────────────
export async function recordOutcome(sessionId: string, data: OutcomeFormData) {
  const state = read();
  const schedule = state.activeSchedule;
  const session = schedule?.sessions.find((item) => item.id === sessionId);
  if (!schedule || !session) throw new ApiError(404, "That study session no longer exists.");

  if (data.outcome !== "Missed" && data.actualMinutes <= 0) {
    throw new ApiError(422, "Enter how many minutes you actually worked.");
  }
  if (data.outcome === "Delayed" && !(data.revisedRemainingMinutes! > 0)) {
    throw new ApiError(422, "Enter how many minutes of work are still left.");
  }

  const updated: StudySession = {
    ...session,
    outcome: data.outcome,
    actualDuration: data.outcome === "Missed" ? 0 : data.actualMinutes,
    isAwaitingOutcome: false,
  };
  schedule.sessions = schedule.sessions.map((item) =>
    item.id === sessionId ? updated : item,
  );

  // Delayed carries work forward; Missed leaves the full planned work standing.
  if (data.outcome === "Delayed") {
    state.revisedRemaining[session.taskId] =
      (state.revisedRemaining[session.taskId] ?? 0) + data.revisedRemainingMinutes!;
  } else if (data.outcome === "Missed") {
    state.revisedRemaining[session.taskId] =
      (state.revisedRemaining[session.taskId] ?? 0) + session.plannedDuration;
  }

  state.outcomes[sessionId] = {
    outcome: data.outcome,
    actualMinutes: updated.actualDuration ?? 0,
    revised: data.revisedRemainingMinutes,
  };
  write(state);

  // A Delayed or Missed outcome triggers a proposed revision (SPEC §14.1).
  let revision: ScheduleRevision | null = null;
  if (data.outcome !== "Completed") {
    const inputs = await loadInputs();
    const settled = schedule.sessions.filter(
      (item) => item.outcome === "Completed" || item.outcome === "Delayed",
    );
    const result = runMockScheduler({
      ...inputs,
      tasks: withRevisedRemaining(inputs.tasks, read()),
      keepSessions: settled,
    });

    const fresh = read();
    revision = {
      id: `mock-revision-${++fresh.counter}`,
      reason:
        data.outcome === "Delayed"
          ? `“${session.taskTitle}” needs ${data.revisedRemainingMinutes} more minutes than planned.`
          : `You missed a session for “${session.taskTitle}”, so ${session.plannedDuration} minutes still need a slot.`,
      proposedSessions: [...settled, ...result.sessions],
      unscheduledWork: result.unscheduledWork,
      overloadWarnings: result.overloadWarnings,
      createdAt: new Date().toISOString(),
    };
    fresh.pendingRevision = revision;
    write(fresh);
  }

  return delay({ session: updated, revision });
}

// ─── Progress ───────────────────────────────────────────────────
export async function listEffortProgress(signal?: AbortSignal): Promise<EffortProgress[]> {
  const state = read();
  const tasks = await tasksApi.listTasks({}, signal);
  const sessions = state.activeSchedule?.sessions ?? [];
  const now = new Date();

  return delay(
    tasks.map((task) => {
      const mine = sessions.filter((session) => session.taskId === task.id);
      const actual = mine.reduce((sum, session) => sum + (session.actualDuration ?? 0), 0);
      const remaining = state.revisedRemaining[task.id] ?? task.remainingDuration;
      const denominator = actual + remaining;
      return {
        taskId: task.id,
        taskTitle: task.title,
        actualDuration: actual,
        estimatedRemaining: remaining,
        effortPercent: denominator > 0 ? Math.round((actual / denominator) * 100) : 0,
        sessionsCompleted: mine.filter((session) => session.outcome === "Completed").length,
        sessionsUpcoming: mine.filter(
          (session) => !session.outcome && new Date(session.startTime) > now,
        ).length,
        status: task.status,
      };
    }),
    signal,
  );
}

export async function getWeeklyProgress(signal?: AbortSignal): Promise<WeeklyProgress> {
  const state = read();
  const sessions = state.activeSchedule?.sessions ?? [];

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start.getTime() + 7 * 86_400_000);

  const thisWeek = sessions.filter((session) => {
    const at = new Date(session.startTime);
    return at >= start && at < end;
  });

  return delay(
    {
      weekStart: start.toISOString(),
      totalMinutesStudied: thisWeek.reduce((sum, s) => sum + (s.actualDuration ?? 0), 0),
      totalMinutesPlanned: thisWeek.reduce((sum, s) => sum + s.plannedDuration, 0),
      sessionsCompleted: thisWeek.filter((s) => s.outcome === "Completed").length,
      tasksCompleted: 0,
    },
    signal,
  );
}

// ─── Adaptive estimation ────────────────────────────────────────
/**
 * A plausible stand-in for SPEC §15.3's median-ratio correction.
 *
 * The real model needs completed-task history the mock does not have, so this
 * derives a stable per-category factor instead. It exists to drive the two
 * screens §15.4 and §15.6 require — it is not the estimation algorithm, and
 * the qualification rules in §15.2 and §15.5 are the backend's to enforce.
 */
const MOCK_FACTORS: Partial<Record<Category, { factor: number; tasks: number }>> = {
  Assignment: { factor: 1.35, tasks: 12 },
  "Exam Preparation": { factor: 2.4, tasks: 8 },
  Reading: { factor: 0.9, tasks: 7 },
  Project: { factor: 1.8, tasks: 6 },
  "Research/Writing": { factor: 2.15, tasks: 5 },
};

export async function getAdaptiveEstimate(
  category: Category,
  originalEstimate: number,
  signal?: AbortSignal,
): Promise<AdaptiveEstimate | null> {
  const entry = MOCK_FACTORS[category];
  if (!entry || !originalEstimate) return delay(null, signal);

  const state = read();
  const adaptive = Math.round(originalEstimate * entry.factor);
  const large = entry.factor > 2 || entry.factor < 0.5;
  const acknowledged = state.acknowledgedCategories.includes(category);

  return delay(
    {
      category,
      originalEstimate,
      adaptiveEstimate: adaptive,
      plannedDuration: large && !acknowledged ? originalEstimate : adaptive,
      factor: entry.factor,
      basedOnTasks: entry.tasks,
      isCategorySpecific: entry.tasks >= 5,
      needsAcknowledgment: large && !acknowledged,
    },
    signal,
  );
}

export async function acknowledgeAdjustment(category: Category): Promise<void> {
  const state = read();
  if (!state.acknowledgedCategories.includes(category)) {
    state.acknowledgedCategories.push(category);
    write(state);
  }
  return delay(undefined);
}
