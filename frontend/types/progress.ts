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
  /**
   * Account-wide summary of how close past estimates were. The backend repeats
   * the same value on every row; null until enough tasks are finished.
   */
  estimationAccuracy?: EstimationAccuracy | null;
}

/** Aggregate estimate accuracy across finished tasks; never per-task errors. */
export interface EstimationAccuracy {
  sampleSize: number;
  originalMeanAbsoluteError: number;
  adaptiveMeanAbsoluteError: number;
  /** Positive when adjusted estimates miss by less; null when not computable. */
  improvementPercent: number | null;
  /** Whether adjusted estimates have earned the right to be used. */
  adaptiveQualified: boolean;
}

export interface WeeklyProgress {
  weekStart: string;
  totalMinutesStudied: number;
  sessionsCompleted: number;
  tasksCompleted: number;
  /** Minutes planned for the week, so studied can be read as a share of it. */
  totalMinutesPlanned: number;
}

/** The history mix an adaptive estimate was drawn from. */
export interface AdaptiveEstimateBasis {
  scope: "category" | "size" | "overall";
  sizeBucket: "small" | "medium" | "large";
  completedRecords: number;
  /** In-progress tasks with partly done sessions, counted at half weight. */
  provisionalRecords: number;
  categoryRecords: number;
  sizeRecords: number;
}

/**
 * An Adaptive Estimate and the history behind it (SPEC §15.6).
 *
 * Per-task model diagnostics — signed bias, individual prediction errors — are
 * deliberately absent; only a likely range and plain-language basis are shown.
 */
export interface AdaptiveEstimate {
  category: import("./task").Category;
  originalEstimate: number;
  adaptiveEstimate: number;
  /** The value that will actually be scheduled. */
  plannedDuration: number;
  /** The original or adaptive estimate currently selected for scheduling. */
  plannedSource: "Original" | "Adaptive";
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
  /** Likely low and high minutes, or null when the backend gives no range. */
  range?: { low: number; high: number } | null;
  sampleSize?: number | null;
  basis?: AdaptiveEstimateBasis | null;
}
