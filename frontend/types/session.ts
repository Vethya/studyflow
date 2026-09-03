export type SessionOutcome = "Completed" | "Delayed" | "Missed";

export interface StudySession {
  id: string;
  taskId: string;
  taskTitle: string;
  category: import("./task").Category;
  /** ISO datetime. */
  startTime: string;
  /** ISO datetime. */
  endTime: string;
  plannedDuration: number;
  /** Minutes actually worked. Present once an outcome is recorded. */
  actualDuration?: number;
  outcome?: SessionOutcome;
  /**
   * A past session with no student-confirmed outcome (SPEC §12.1). Its work is
   * still treated as remaining, and StudyFlow never auto-marks it Missed.
   */
  isAwaitingOutcome: boolean;
}

export interface OutcomeFormData {
  outcome: SessionOutcome;
  /** Zero for Missed; greater than zero for Completed and Delayed. */
  actualMinutes: number;
  /** Delayed only, and must be greater than zero. */
  revisedRemainingMinutes?: number;
}

/**
 * Minutes above which a manual entry is unusual enough to confirm (SPEC §12.2).
 * The entry stays allowed either way — the prompt only guards against a typo.
 */
export const LARGE_ENTRY_FACTOR = 2;
