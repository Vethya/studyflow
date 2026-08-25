/**
 * Scheduling, sessions, outcomes, revisions, progress and adaptive estimation.
 *
 * ═════════════════════════════════════════════════════════════════════════
 *  INTEGRATION POINT — this is the only file that needs to change when the
 *  backend engine ships.
 *
 *  Every function below is the shape the real client should have, and the UI
 *  imports nothing else. To integrate: replace each function body with the
 *  matching `apiJson(...)` / `apiVoid(...)` call, delete `./scheduling-store`
 *  and `lib/mock-scheduler.ts`, and leave the signatures alone. No screen,
 *  hook or component should need editing.
 *
 *  Endpoints these are waiting on:
 *    GET    /sessions
 *    GET    /schedule/active
 *    POST   /schedule/proposals            → inactive proposal (SPEC §11.1)
 *    POST   /schedule/proposals/{id}/accept
 *    POST   /schedule/proposals/{id}/reject
 *    GET    /schedule/revision             → pending revision, or 204
 *    POST   /sessions/{id}/outcome         → may return a revision (SPEC §14.1)
 *    GET    /progress/effort
 *    GET    /progress/weekly
 *    GET    /estimation/adaptive?category=&original_estimate_minutes=
 *    POST   /estimation/acknowledgements
 * ═════════════════════════════════════════════════════════════════════════
 */

import * as store from "./scheduling-store";
import type { OutcomeFormData, StudySession } from "@/types/session";
import type { Schedule, ScheduleProposal, ScheduleRevision } from "@/types/schedule";
import type { AdaptiveEstimate, EffortProgress, WeeklyProgress } from "@/types/progress";
import type { Category } from "@/types/task";

/**
 * CP-SAT timed out or failed technically (SPEC §10.7).
 *
 * Deliberately its own type: a technical failure must never be presented as
 * Overload, and must never replace the active schedule.
 */
export class ScheduleTechnicalFailure extends Error {
  constructor(message = "The scheduler could not finish in time.") {
    super(message);
    this.name = "ScheduleTechnicalFailure";
  }
}

export interface OutcomeResult {
  session: StudySession;
  /** Present after a Delayed or Missed outcome (SPEC §14.1). */
  revision: ScheduleRevision | null;
}

// ─── Sessions ───────────────────────────────────────────────────
export function listSessions(signal?: AbortSignal): Promise<StudySession[]> {
  return store.listSessions(signal);
}

export function getSession(sessionId: string, signal?: AbortSignal): Promise<StudySession> {
  return store.getSession(sessionId, signal);
}

// ─── Active schedule and proposals ──────────────────────────────
export function getActiveSchedule(signal?: AbortSignal): Promise<Schedule | null> {
  return store.getActiveSchedule(signal);
}

/** Creates an *inactive* proposal. Never replaces the active schedule. */
export function generateProposal(): Promise<ScheduleProposal> {
  return store.generateProposal();
}

/** Accepts the complete proposal. Partial acceptance is not supported. */
export function acceptProposal(proposalId: string): Promise<Schedule> {
  return store.acceptProposal(proposalId);
}

export function rejectProposal(proposalId: string): Promise<void> {
  return store.rejectProposal(proposalId);
}

// ─── Revisions ──────────────────────────────────────────────────
export function getPendingRevision(signal?: AbortSignal): Promise<ScheduleRevision | null> {
  return store.getPendingRevision(signal);
}

// ─── Outcomes ───────────────────────────────────────────────────
export function recordOutcome(
  sessionId: string,
  data: OutcomeFormData,
): Promise<OutcomeResult> {
  return store.recordOutcome(sessionId, data);
}

// ─── Progress ───────────────────────────────────────────────────
export function listEffortProgress(signal?: AbortSignal): Promise<EffortProgress[]> {
  return store.listEffortProgress(signal);
}

export function getWeeklyProgress(signal?: AbortSignal): Promise<WeeklyProgress> {
  return store.getWeeklyProgress(signal);
}

// ─── Adaptive estimation ────────────────────────────────────────
export function getAdaptiveEstimate(
  category: Category,
  originalEstimate: number,
  signal?: AbortSignal,
): Promise<AdaptiveEstimate | null> {
  return store.getAdaptiveEstimate(category, originalEstimate, signal);
}

export function acknowledgeAdjustment(category: Category): Promise<void> {
  return store.acknowledgeAdjustment(category);
}
