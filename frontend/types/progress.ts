export interface EffortProgress {
  taskId: string;
  taskTitle: string;
  actualDuration: number; // minutes
  estimatedRemaining: number; // minutes
  effortPercent: number; // 0-100
  sessionsCompleted: number;
  sessionsUpcoming: number;
  status: import("./task").TaskStatus;
}

export interface WeeklyProgress {
  weekStart: string;
  totalMinutesStudied: number;
  sessionsCompleted: number;
  tasksCompleted: number;
}
