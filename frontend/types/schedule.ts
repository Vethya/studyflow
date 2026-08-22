import type { StudySession } from "./session";

export interface Schedule {
  id: string;
  sessions: StudySession[];
  createdAt: string;
  isActive: boolean;
}

export interface ScheduleRevision {
  id: string;
  reason: string;
  proposedSessions: StudySession[];
  unscheduledWork: UnscheduledWork[];
  overloadWarnings: OverloadWarning[];
  isAccepted: boolean | null; // null = pending
  createdAt: string;
}

export interface UnscheduledWork {
  taskId: string;
  taskTitle: string;
  remainingMinutes: number;
  reason: string;
}

export interface OverloadWarning {
  taskId: string;
  taskTitle: string;
  deadline: string;
  requiredMinutes: number;
  availableMinutes: number;
  shortfallMinutes: number;
  relevantUnavailablePeriods: string[];
  remedies: string[];
}
