/**
 * Scheduling, sessions, outcomes, revisions and progress.
 *
 * Backed by the real API as of the `dev` merge:
 *   GET    /study-sessions                      accepted sessions
 *   GET    /study-sessions/{id}
 *   POST   /study-sessions/{id}/outcomes        currently "missed" only
 *   POST   /schedule-proposals                  generate (inactive proposal)
 *   GET    /schedule-proposals/current          pending proposal, or 404
 *   POST   /schedule-proposals/{id}/accept
 *   POST   /schedule-proposals/{id}/reject
 *
 * Two things the backend does not expose yet, handled here rather than in the
 * screens so the seam stays in one place:
 *
 *  - **Effort progress has no endpoint.** `listEffortProgress` and
 *    `getWeeklyProgress` derive their figures from tasks plus accepted
 *    sessions. The arithmetic is SPEC §13's, but it runs in the browser.
 *  - **Adaptive estimation has no endpoint.** `getAdaptiveEstimate` returns
 *    null, so the §15.6 explanation and the §15.4 acknowledgement stay hidden
 *    until the model ships. Returning null rather than a guess keeps the UI
 *    honest — it simply does not claim to know anything about your history.
 */

import { apiJson, apiVoid, ApiError, buildQuery } from "./client";
import { listTasks } from "./tasks";
import {
  toEffortProgress,
  toScheduleProposal,
  toStudySession,
  toWeeklyProgress,
} from "./mappers";
import type {
  WireScheduleProposal,
  WireStudySession,
} from "./wire";
import type { OutcomeFormData, StudySession } from "@/types/session";
import type { Schedule, ScheduleProposal, ScheduleRevision } from "@/types/schedule";
import type { AdaptiveEstimate, EffortProgress, WeeklyProgress } from "@/types/progress";
import type { AcademicTask, Category } from "@/types/task";

/**
 * CP-SAT timed out or could not prove its objective (SPEC §10.7), surfaced by
 * the API as 503.
 *
 * Deliberately its own type: a technical failure must never be presented as
 * Overload, and must never replace the active schedule. Proven infeasibility
 * is a *successful* response whose status is "overload" — a different thing.
 */
export class ScheduleTechnicalFailure extends Error {
  constructor(message = "The scheduler could not finish in time.") {
    super(message);
    this.name = "ScheduleTechnicalFailure";
  }
}

/** Recording Completed or Delayed is not reachable through the API yet. */
export class OutcomeNotSupportedError extends Error {
  constructor(readonly outcome: string) {
    super(
      `Recording “${outcome}” is not available yet — the API accepts only missed sessions.`,
    );
    this.name = "OutcomeNotSupportedError";
  }
}

export interface OutcomeResult {
  session: StudySession;
  /** Present when the outcome produced a revision (SPEC §14.1). */
  revision: ScheduleRevision | null;
}

/** Titles for the session list, which the API returns without them. */
async function taskTitles(signal?: AbortSignal): Promise<Map<string, string>> {
  const tasks = await listTasks({}, signal);
  return new Map(tasks.map((task) => [task.id, task.title]));
}

// ─── Sessions ───────────────────────────────────────────────────
export async function listSessions(signal?: AbortSignal): Promise<StudySession[]> {
  const [wire, titles] = await Promise.all([
    apiJson<WireStudySession[]>(`/study-sessions${buildQuery({})}`, { signal }),
    taskTitles(signal),
  ]);
  return wire.map((session) => toStudySession(session, titles));
}

export async function getSession(
  sessionId: string,
  signal?: AbortSignal,
): Promise<StudySession> {
  const [wire, titles] = await Promise.all([
    apiJson<WireStudySession>(`/study-sessions/${sessionId}`, { signal }),
    taskTitles(signal),
  ]);
  return toStudySession(wire, titles);
}

// ─── Active schedule ────────────────────────────────────────────
/**
 * There is no "active schedule" resource: accepting a proposal turns its
 * sessions into the accepted set, and `GET /study-sessions` returns exactly
 * that. This wraps them so callers keep a single shape.
 */
export async function getActiveSchedule(signal?: AbortSignal): Promise<Schedule | null> {
  const sessions = await listSessions(signal);
  if (sessions.length === 0) return null;
  return {
    id: "active",
    sessions,
    createdAt: sessions[0].startTime,
    isActive: true,
  };
}

// ─── Proposals ──────────────────────────────────────────────────
export async function generateProposal(): Promise<ScheduleProposal> {
  try {
    const wire = await apiJson<WireScheduleProposal>("/schedule-proposals", {
      method: "POST",
    });
    return toScheduleProposal(wire);
  } catch (cause) {
    // 503 is the labelled technical failure; everything else keeps its meaning.
    if (cause instanceof ApiError && cause.status === 503) {
      throw new ScheduleTechnicalFailure(cause.message);
    }
    throw cause;
  }
}

/** The pending proposal, or null when there is none (the API 404s). */
export async function getPendingRevision(
  signal?: AbortSignal,
): Promise<ScheduleRevision | null> {
  try {
    const wire = await apiJson<WireScheduleProposal>("/schedule-proposals/current", {
      signal,
    });
    const proposal = toScheduleProposal(wire);
    return { ...proposal, reason: proposal.reason ?? "" };
  } catch (cause) {
    if (cause instanceof ApiError && cause.isNotFound) return null;
    throw cause;
  }
}

export async function acceptProposal(proposalId: string): Promise<Schedule> {
  await apiVoid(`/schedule-proposals/${proposalId}/accept`, { method: "POST" });
  // The accept response carries only the sessions it just activated; re-read
  // so the caller gets the full accepted set with outcomes attached.
  return (await getActiveSchedule()) ?? {
    id: "active",
    sessions: [],
    createdAt: new Date().toISOString(),
    isActive: true,
  };
}

export function rejectProposal(proposalId: string): Promise<void> {
  return apiVoid(`/schedule-proposals/${proposalId}/reject`, { method: "POST" });
}

// ─── Outcomes ───────────────────────────────────────────────────
/**
 * Records what happened in a past session.
 *
 * `RecordSessionOutcomeRequest` currently accepts `outcome: "missed"` only.
 * Completed and Delayed exist in the domain enum but have no route, so they
 * are rejected here with a clear error rather than sent and 422'd.
 */
export async function recordOutcome(
  sessionId: string,
  data: OutcomeFormData,
): Promise<OutcomeResult> {
  if (data.outcome !== "Missed") {
    throw new OutcomeNotSupportedError(data.outcome);
  }

  const recovery = await apiJson<{
    session: WireStudySession;
    revision: WireScheduleProposal | null;
  }>(`/study-sessions/${sessionId}/outcomes`, {
    method: "POST",
    body: { outcome: "missed" },
  });

  const titles = await taskTitles();
  const revision = recovery.revision ? toScheduleProposal(recovery.revision) : null;
  return {
    session: toStudySession(recovery.session, titles),
    revision: revision ? { ...revision, reason: revision.reason ?? "" } : null,
  };
}

// ─── Progress (derived — no endpoint yet) ───────────────────────
export async function listEffortProgress(
  signal?: AbortSignal,
): Promise<EffortProgress[]> {
  const [tasks, sessions] = await Promise.all([
    listTasks({}, signal),
    listSessions(signal),
  ]);
  return toEffortProgress(tasks as AcademicTask[], sessions);
}

export async function getWeeklyProgress(signal?: AbortSignal): Promise<WeeklyProgress> {
  return toWeeklyProgress(await listSessions(signal));
}

// ─── Adaptive estimation (not implemented server-side) ──────────
// The parameters are kept so the signature matches what the real endpoint
// will need; nothing reads them until it exists.
/* eslint-disable @typescript-eslint/no-unused-vars */
export async function getAdaptiveEstimate(
  _category: Category,
  _originalEstimate: number,
  _signal?: AbortSignal,
): Promise<AdaptiveEstimate | null> {
  return null;
}

export async function acknowledgeAdjustment(_category: Category): Promise<void> {
  // No-op until the estimation model ships.
}
/* eslint-enable @typescript-eslint/no-unused-vars */
