import type { WireAcademicTask, WireScheduleProposal, WireStudySession } from "@/lib/api/wire";
import { toAcademicTask, toStudySession, toScheduleProposal } from "@/lib/api/mappers";

export const NOW = "2026-10-16T05:00:00Z";
export const account = { id: "student", name: "Alex Student", email: "alex@example.edu", password_set: true };
export const preferences = { timezone: "Asia/Phnom_Penh", preferred_session_length_minutes: 60, minimum_break_minutes: 10, availability_confirmation_required: false };
export const wireTask: WireAcademicTask = {
  id: "reading", title: "Read cognitive science paper", category: "reading", priority: "high",
  course: "PSY101", notes: "Highlight the main findings.", deadline_at: "2026-10-21T14:00:00Z",
  original_estimate_minutes: 120, adaptive_estimate_minutes: 150, planned_source: "adaptive",
  planned_duration_minutes: 150, estimate_frozen: false, status: "not_started", created_at: NOW, updated_at: NOW,
};
export const wireSessions: WireStudySession[] = [
  { id: "past", task_id: "reading", task_title: wireTask.title, task_category: wireTask.category, starts_at: "2026-10-15T11:00:00Z", ends_at: "2026-10-15T12:00:00Z", planned_duration_minutes: 60, outcome: null },
  { id: "future", task_id: "reading", task_title: wireTask.title, task_category: wireTask.category, starts_at: "2026-10-17T11:00:00Z", ends_at: "2026-10-17T12:00:00Z", planned_duration_minutes: 60, outcome: null },
];
export const wireProposal: WireScheduleProposal = {
  id: "proposal", kind: "generation", revision_reason: null, status: "feasible", created_at: NOW,
  sessions: [{ ...wireSessions[1], task_title: wireTask.title }],
  task_allocations: [], unscheduled_work: [], overload_warning: null, scenario: null,
};
export const wireWindows = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ id: `window-${weekday}`, weekday, start_time: "18:00:00", end_time: "21:00:00", crosses_midnight: false }));
export const wirePeriod = { id: "blocked", starts_at: "2026-10-18T11:00:00Z", ends_at: "2026-10-18T12:00:00Z", reason: "Office hours" };
export const task = toAcademicTask(wireTask);
export const sessions = wireSessions.map((s) => toStudySession(s, task));
export const proposal = toScheduleProposal(wireProposal);
export const estimate = { category: task.category, originalEstimate: 120, adaptiveEstimate: 150, plannedDuration: 150, plannedSource: "Adaptive" as const, factor: 1.25, basedOnTasks: 6, isCategorySpecific: true, needsAcknowledgment: false };
