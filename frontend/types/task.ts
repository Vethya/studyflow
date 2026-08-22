export type Category =
  | "Assignment"
  | "Reading"
  | "Exam Preparation"
  | "Project"
  | "Research/Writing"
  | "Other";

export type Priority = "Low" | "Medium" | "High";

export type TaskStatus = "Not Started" | "In Progress" | "Completed" | "Overdue";

export interface AcademicTask {
  id: string;
  title: string;
  category: Category;
  deadline: string; // ISO datetime
  priority: Priority;
  originalEstimate: number; // minutes
  adaptiveEstimate?: number; // minutes, undefined until qualified
  plannedDuration: number; // minutes — original or adaptive
  actualDuration: number; // minutes — sum of completed/delayed work
  remainingDuration: number; // minutes
  course?: string; // max 100 chars
  notes?: string; // max 2000 chars
  status: TaskStatus;
  sessionsCompleted: number;
  sessionsUpcoming: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskFormData {
  title: string;
  category: Category;
  deadline: string;
  priority: Priority;
  originalEstimate: number;
  course?: string;
  notes?: string;
}

export const CATEGORIES: Category[] = [
  "Assignment",
  "Reading",
  "Exam Preparation",
  "Project",
  "Research/Writing",
  "Other",
];

export const PRIORITIES: Priority[] = ["Low", "Medium", "High"];

export const TASK_STATUSES: TaskStatus[] = [
  "Not Started",
  "In Progress",
  "Completed",
  "Overdue",
];
