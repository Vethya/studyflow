import type { StudySession } from "./session";

export interface Schedule {
  id: string;
  sessions: StudySession[];
  createdAt: string;
  isActive: boolean;
}

/**
 * Remaining work with no valid session (SPEC §5.4).
 *
 * This is narrower than "work you have left to do": it is work the scheduler
 * could not place, or whose session was invalidated and not yet replaced. It
 * stays visible until constraints change or a valid revision is accepted.
 */
export interface UnscheduledWork {
  taskId: string;
  taskTitle: string;
  remainingMinutes: number;
  /** Why it could not be placed, in the student's language. */
  reason: string;
}

/** Every field SPEC §10.5 requires of an Overload explanation. */
export interface OverloadWarning {
  taskId: string;
  taskTitle: string;
  deadline: string;
  requiredMinutes: number;
  availableMinutes: number;
  shortfallMinutes: number;
  relevantUnavailablePeriods: string[];
}

/**
 * An inactive proposal (SPEC §11.1). Generation never replaces the active
 * schedule; the student accepts or rejects the whole thing (SPEC §11.2).
 */
export interface ScheduleProposal {
  id: string;
  /** Absent for a plain regeneration; set for a revision (SPEC §14.2). */
  reason?: string;
  proposedSessions: StudySession[];
  unscheduledWork: UnscheduledWork[];
  overloadWarnings: OverloadWarning[];
  createdAt: string;
}

/**
 * A revision is a proposal carrying the reason it was triggered — always a
 * Delayed or Missed outcome (SPEC §14.1).
 */
export interface ScheduleRevision extends ScheduleProposal {
  reason: string;
}
