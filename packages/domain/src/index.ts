import { z } from "zod";

export const categories = [
  "Assignment",
  "Reading",
  "Exam Preparation",
  "Project",
  "Research/Writing",
  "Other",
] as const;

export const priorities = ["Low", "Medium", "High"] as const;
export const taskStatuses = ["Not Started", "In Progress", "Completed", "Overdue"] as const;
export const sessionOutcomes = ["Completed", "Delayed", "Missed"] as const;

export type Category = (typeof categories)[number];
export type Priority = (typeof priorities)[number];
export type TaskStatus = (typeof taskStatuses)[number];
export type SessionOutcome = (typeof sessionOutcomes)[number];

export interface AcademicTask {
  id: string;
  title: string;
  category: Category;
  deadline: string;
  priority: Priority;
  originalEstimate: number;
  adaptiveEstimate?: number;
  plannedSource: "Original" | "Adaptive";
  plannedDuration: number;
  estimateFrozen?: boolean;
  actualDuration: number;
  remainingDuration: number;
  course?: string;
  notes?: string;
  status: TaskStatus;
  sessionsCompleted: number;
  sessionsUpcoming: number;
  createdAt: string;
  updatedAt: string;
}

export interface StudySession {
  id: string;
  taskId: string;
  taskTitle: string;
  category: Category;
  startTime: string;
  endTime: string;
  plannedDuration: number;
  actualDuration?: number;
  outcome?: SessionOutcome;
  isAwaitingOutcome: boolean;
}

export interface AvailabilityWindow {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface UnavailablePeriod {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  reason?: string;
}

export const taskFormSchema = z.object({
  title: z.string().trim().min(1).max(200),
  category: z.enum(categories),
  deadline: z.string().min(1),
  priority: z.enum(priorities),
  originalEstimate: z.number().int().min(1).max(10080),
  plannedSource: z.enum(["Original", "Adaptive"]).optional(),
  course: z.string().trim().max(100).optional(),
  notes: z.string().max(2000).optional(),
});

export type TaskFormData = z.infer<typeof taskFormSchema>;

export const sessionOutcomeSchema = z.object({
  outcome: z.enum(sessionOutcomes),
  actualMinutes: z.number().int().min(0),
  revisedRemainingMinutes: z.number().int().positive().optional(),
  largeActualConfirmed: z.boolean().optional(),
});

export type SessionOutcomeFormData = z.infer<typeof sessionOutcomeSchema>;
