/**
 * Scheduling, sessions, outcomes, revisions and progress.
 *
 * Backed by the real API as of the `dev` merge:
 *   GET    /study-sessions                      accepted sessions
 *   GET    /study-sessions/{id}
 *   POST   /study-sessions/{id}/outcomes        records completed, delayed, or missed
 *   POST   /schedule-proposals                  generate (inactive proposal)
 *   GET    /schedule-proposals/current          pending proposal, or 404
 *   POST   /schedule-proposals/{id}/accept
 *   POST   /schedule-proposals/{id}/reject
 *   GET    /progress                            server-calculated effort progress
 */

import { apiJson, apiVoid, ApiError, buildQuery } from "./client";
import { toWireOutcome } from "./outcome-contract";
import { toAdaptiveEstimate } from "./adaptive-contract";
import { listTasks } from "./tasks";
import { toScheduleProposal, toStudySession, toWireCategory } from "./mappers";
import type {
  WireScheduleProposal,
  WireScheduleScenario,
  WireAdaptiveEstimatePreview,
  WireSessionOutcomeRecordingResponse,
  WireScheduleSimulation,
  WireStudySession,
} from "./wire";
import type { ScenarioOverrides, SimulatePlanResult } from "@/lib/webmcp/contracts";
import type { OutcomeFormData, StudySession } from "@/types/session";
import type { Schedule, ScheduleProposal, ScheduleRevision } from "@/types/schedule";
import type { AdaptiveEstimate } from "@/types/progress";
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

export interface OutcomeResult {
  session: StudySession;
  /** Present when the outcome produced a revision (SPEC §14.1). */
  revision: ScheduleRevision | null;
}

/** Titles for the session list, which the API returns without them. */
async function taskTitles(
  signal?: AbortSignal,
  tasks?: AcademicTask[],
): Promise<Map<string, string>> {
  const rows = tasks ?? (await listTasks({}, signal));
  return new Map(rows.map((task) => [task.id, task.title]));
}

// ─── Sessions ───────────────────────────────────────────────────
export async function listSessions(
  signal?: AbortSignal,
  tasks?: AcademicTask[],
): Promise<StudySession[]> {
  const [wire, titles] = await Promise.all([
    apiJson<WireStudySession[]>(`/study-sessions${buildQuery({})}`, { signal }),
    taskTitles(signal, tasks),
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
export async function getActiveSchedule(
  signal?: AbortSignal,
  tasks?: AcademicTask[],
): Promise<Schedule | null> {
  const sessions = await listSessions(signal, tasks);
  if (sessions.length === 0) return null;
  return {
    id: "active",
    sessions,
    createdAt: sessions[0].startTime,
    isActive: true,
  };
}

// ─── Proposals ──────────────────────────────────────────────────
function toScenario(wire: WireScheduleScenario): ScenarioOverrides {
  return {
    temporary_availability: wire.temporary_availability.map((item) => ({
      starts_at: item.starts_at,
      ends_at: item.ends_at,
    })),
    temporary_blocked_periods: wire.temporary_blocked_periods.map((item) => ({
      starts_at: item.starts_at,
      ends_at: item.ends_at,
      ...(item.reason ? { reason: item.reason } : {}),
    })),
    deadline_overrides: wire.deadline_overrides.map((item) => ({
      task_id: item.task_id,
      deadline_at: item.deadline_at,
    })),
  };
}

export async function generateProposal(
  scenario?: ScenarioOverrides,
  signal?: AbortSignal,
): Promise<ScheduleProposal> {
  try {
    const wire = await apiJson<WireScheduleProposal>("/schedule-proposals", {
      method: "POST",
      body: scenario === undefined ? undefined : { scenario },
      signal,
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

export async function simulatePlan(
  scenario: ScenarioOverrides,
  signal?: AbortSignal,
): Promise<SimulatePlanResult> {
  try {
    const wire = await apiJson<WireScheduleSimulation>("/schedule-proposals/simulate", {
      method: "POST",
      body: { scenario },
      signal,
      notifyDataChanged: false,
    });
    return {
      scenario: wire.proposal.scenario ? toScenario(wire.proposal.scenario) : scenario,
      proposal: toScheduleProposal(wire.proposal),
    };
  } catch (cause) {
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

export async function acceptProposal(
  proposalId: string,
  signal?: AbortSignal,
  refreshActiveSchedule = true,
): Promise<Schedule> {
  await apiVoid(`/schedule-proposals/${proposalId}/accept`, { method: "POST", signal });
  if (!refreshActiveSchedule) {
    return { id: "active", sessions: [], createdAt: new Date().toISOString(), isActive: true };
  }
  // The accept response carries only the sessions it just activated; re-read
  // so the caller gets the full accepted set with outcomes attached.
  return (await getActiveSchedule(signal)) ?? {
    id: "active",
    sessions: [],
    createdAt: new Date().toISOString(),
    isActive: true,
  };
}

export function rejectProposal(proposalId: string, signal?: AbortSignal): Promise<void> {
  return apiVoid(`/schedule-proposals/${proposalId}/reject`, { method: "POST", signal });
}

// ─── Outcomes ───────────────────────────────────────────────────
/**
 * Records what happened in a past session.
 *
 * The backend returns the recorded outcome, its updated accepted session, and
 * an optional revision for student review.
 */
export async function recordOutcome(
  sessionId: string,
  data: OutcomeFormData,
  signal?: AbortSignal,
  taskTitle?: string,
): Promise<OutcomeResult> {
  try {
    const response = await apiJson<WireSessionOutcomeRecordingResponse>(
      `/study-sessions/${sessionId}/outcomes`,
      {
        method: "POST",
        body: toWireOutcome(data, data.largeActualConfirmed ?? false),
        signal,
      },
    );

    const titles = taskTitle
      ? new Map([[response.session.task_id, taskTitle]])
      : await taskTitles(signal);
    const revision = response.revision ? toScheduleProposal(response.revision) : null;
    return {
      session: toStudySession(response.session, titles),
      revision: revision ? { ...revision, reason: revision.reason ?? "" } : null,
    };
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 503) {
      throw new ScheduleTechnicalFailure(cause.message);
    }
    throw cause;
  }
}

// ─── Progress ───────────────────────────────────────────────────
/** `GET /progress`; kept here so existing `scheduling.listEffortProgress` callers work. */
export { listEffortProgress } from "./progress";


// ─── Adaptive estimation ────────────────────────────────────────
export async function getAdaptiveEstimate(
  category: Category,
  originalEstimate: number,
  signal?: AbortSignal,
): Promise<AdaptiveEstimate | null> {
  const wire = await apiJson<WireAdaptiveEstimatePreview>(
    `/adaptive-estimates/preview${buildQuery({
      category: toWireCategory(category),
      original_minutes: originalEstimate,
    })}`,
    { signal },
  );
  return toAdaptiveEstimate(wire);
}

export function acknowledgeAdjustment(category: Category, signal?: AbortSignal): Promise<void> {
  return apiVoid("/adaptive-estimates/acknowledgments", {
    method: "POST",
    body: { category: toWireCategory(category) },
    signal,
  });
}
