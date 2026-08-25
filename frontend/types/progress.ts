export interface EffortProgress {
  taskId: string;
  taskTitle: string;
  /** Minutes actually worked, summed across Completed and Delayed sessions. */
  actualDuration: number;
  estimatedRemaining: number;
  /** `actual / (actual + remaining)`, 0–100. */
  effortPercent: number;
  sessionsCompleted: number;
  sessionsUpcoming: number;
  status: import("./task").TaskStatus;
}

export interface WeeklyProgress {
  weekStart: string;
  totalMinutesStudied: number;
  sessionsCompleted: number;
  tasksCompleted: number;
  /** Minutes planned for the week, so studied can be read as a share of it. */
  totalMinutesPlanned: number;
}

/**
 * An Adaptive Estimate and the history behind it (SPEC §15.6).
 *
 * Model-accuracy analytics — MAE, signed bias, prediction error, sample counts
 * — are deliberately absent: SPEC §15.6 forbids exposing them to the student.
 */
export interface AdaptiveEstimate {
  category: import("./task").Category;
  originalEstimate: number;
  adaptiveEstimate: number;
  /** The value that will actually be scheduled. */
  plannedDuration: number;
  /** `adaptiveEstimate / originalEstimate`. */
  factor: number;
  /** How many completed tasks the correction is drawn from. */
  basedOnTasks: number;
  /** True when the category's history is used rather than overall history. */
  isCategorySpecific: boolean;
  /**
   * A first-time adjustment beyond 2× or below 0.5× must be acknowledged
   * before it is used for scheduling (SPEC §15.4).
   */
  needsAcknowledgment: boolean;
}
