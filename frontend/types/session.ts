export type SessionOutcome = "Completed" | "Delayed" | "Missed";

export interface StudySession {
  id: string;
  taskId: string;
  taskTitle: string;
  category: import("./task").Category;
  startTime: string; // ISO datetime
  endTime: string; // ISO datetime
  plannedDuration: number; // minutes
  actualDuration?: number; // minutes
  outcome?: SessionOutcome;
  isAwaitingOutcome: boolean;
  isPinned: boolean;
}

export interface OutcomeFormData {
  outcome: SessionOutcome;
  actualMinutes: number;
  revisedRemainingMinutes?: number; // only for Delayed
}
