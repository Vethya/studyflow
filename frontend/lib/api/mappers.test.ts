import { afterEach, expect, it, vi } from "vitest";
import {
  dayOfWeekToWireWeekday,
  toAcademicTask,
  toEffortProgress,
  toScheduleProposal,
  toStudentAccount,
  toStudySession,
  toUnavailablePeriod,
  wireWeekdayToDayOfWeek,
} from "./mappers";

afterEach(() => vi.useRealTimers());

it("converts weekdays in both directions between the UI and backend conventions", () => {
  expect(Array.from({ length: 7 }, (_, day) => dayOfWeekToWireWeekday(day))).toEqual([
    6, 0, 1, 2, 3, 4, 5,
  ]);
  expect(Array.from({ length: 7 }, (_, weekday) => wireWeekdayToDayOfWeek(weekday))).toEqual([
    1, 2, 3, 4, 5, 6, 0,
  ]);
});

it("uses server progress and preserves completed-task remaining work rules", () => {
  const base = {
    id: "task-1",
    title: "Read",
    category: "reading" as const,
    priority: "medium" as const,
    course: null,
    notes: null,
    deadline_at: "2026-10-10T12:00:00Z",
    original_estimate_minutes: 90,
    adaptive_estimate_minutes: 120,
    planned_source: "adaptive" as const,
    planned_duration_minutes: 120,
    estimate_frozen: true,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    status: "in_progress" as const,
  };

  expect(toAcademicTask(base, {
    taskId: "task-1",
    taskTitle: "Read",
    actualDuration: 45,
    estimatedRemaining: 75,
    effortPercent: 38,
    sessionsCompleted: 1,
    sessionsUpcoming: 2,
    status: "In Progress",
  })).toMatchObject({
    category: "Reading",
    plannedSource: "Adaptive",
    plannedDuration: 120,
    actualDuration: 45,
    remainingDuration: 75,
  });

  expect(toAcademicTask({ ...base, status: "completed" })).toMatchObject({
    status: "Completed",
    remainingDuration: 0,
  });
});

it("maps account identity and preferences without exposing backend field names", () => {
  expect(toStudentAccount(
    { id: "account-1", email: "student@example.com", name: "Student" },
    {
      timezone: "Asia/Phnom_Penh",
      preferred_session_length_minutes: 50,
      minimum_break_minutes: 10,
      availability_confirmation_required: false,
    },
    [{ provider: "google", email: "student@example.com", linked_at: "2026-09-01T00:00:00Z" }],
  )).toEqual({
    id: "account-1",
    email: "student@example.com",
    name: "Student",
    isEmailVerified: true,
    hasGoogleLinked: true,
    timezone: "Asia/Phnom_Penh",
    preferredSessionLength: 50,
    minimumBreak: 10,
  });
});

it("handles accounts without a linked Google identity", () => {
  expect(toStudentAccount(
    { id: "account-1", email: "student@example.com", name: "Student" },
    {
      timezone: "UTC",
      preferred_session_length_minutes: 25,
      minimum_break_minutes: 5,
      availability_confirmation_required: true,
    },
    [],
  )).toMatchObject({ hasGoogleLinked: false, timezone: "UTC" });
});

it("uses safe defaults when a task has no progress or optional wire fields", () => {
  expect(toAcademicTask({
    id: "task-2",
    title: "Other work",
    category: "other",
    priority: "low",
    course: null,
    notes: null,
    deadline_at: "2026-10-10T12:00:00Z",
    original_estimate_minutes: 30,
    adaptive_estimate_minutes: null,
    planned_source: "original",
    planned_duration_minutes: 30,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    status: "in_progress",
  })).toMatchObject({
    plannedSource: "Original",
    estimateFrozen: false,
    adaptiveEstimate: undefined,
    remainingDuration: 30,
    actualDuration: 0,
    sessionsCompleted: 0,
    sessionsUpcoming: 0,
    course: undefined,
    notes: undefined,
  });
});

it("derives awaiting outcomes only for finished sessions without an outcome", () => {
  vi.setSystemTime(new Date("2026-10-01T20:00:00Z"));
  const wire = {
    id: "session-1",
    task_id: "task-1",
    starts_at: "2026-10-01T17:00:00Z",
    ends_at: "2026-10-01T18:00:00Z",
    planned_duration_minutes: 60,
    outcome: null,
  };

  expect(toStudySession(wire, new Map([["task-1", "Read"]]))).toMatchObject({
    taskTitle: "Read",
    isAwaitingOutcome: true,
  });
  expect(toStudySession({ ...wire, outcome: {
    session_id: "session-1",
    kind: "missed",
    actual_minutes: 0,
    remaining_minutes: 60,
    recorded_at: "2026-10-01T19:00:00Z",
    rescheduled_at: null,
  } })).toMatchObject({ outcome: "Missed", isAwaitingOutcome: false });
  expect(toStudySession({ ...wire, outcome: {
    session_id: "session-1",
    kind: "completed",
    actual_minutes: 60,
    remaining_minutes: 0,
    recorded_at: "2026-10-01T19:00:00Z",
    rescheduled_at: null,
  } }, new Map([["task-1", "Read"]]))).toMatchObject({ taskTitle: "Read", outcome: "Completed", isAwaitingOutcome: false });
  expect(toStudySession({ ...wire, task_id: "missing-task", outcome: null })).toMatchObject({
    taskTitle: "Untitled task",
  });
});

it("limits overload unavailable periods to those before each task deadline", () => {
  const proposal = {
    id: "proposal-1",
    kind: "generation" as const,
    revision_reason: null,
    status: "overload" as const,
    created_at: "2026-09-01T00:00:00Z",
    sessions: [],
    task_allocations: [{
      task_id: "task-1",
      task_title: "Read",
      deadline_at: "2026-10-02T12:00:00Z",
      required_minutes: 120,
      scheduled_minutes: 60,
      unscheduled_minutes: 60,
      raw_calendar_capacity_minutes: 60,
      available_minutes_before_deadline: 60,
      shortfall_minutes: 60,
    }],
    unscheduled_work: [],
    overload_warning: {
      affected_tasks: [],
      relevant_unavailable_periods: [
        { id: "before", starts_at: "2026-10-01T10:00:00Z", ends_at: "2026-10-01T11:00:00Z", reason: "Exam" },
        { id: "after", starts_at: "2026-10-03T10:00:00Z", ends_at: "2026-10-03T11:00:00Z", reason: "Trip" },
      ],
      remedies: ["add_availability" as const],
    },
    scenario: null,
  };

  expect(toScheduleProposal(proposal).overloadWarnings[0].relevantUnavailablePeriods.map((item) => item.id)).toEqual([
    "before",
  ]);
});

it("uses a readable fallback title for unavailable periods without a reason", () => {
  expect(toUnavailablePeriod({
    id: "period-1",
    starts_at: "2026-10-01T10:00:00Z",
    ends_at: "2026-10-01T11:00:00Z",
    reason: null,
  })).toMatchObject({ title: "Unavailable", reason: undefined });
});

it("maps revision scenarios, fallback titles, and default overload remedies", () => {
  const proposal = {
    id: "proposal-2",
    kind: "revision" as const,
    revision_reason: null,
    status: "overload" as const,
    created_at: "2026-09-01T00:00:00Z",
    sessions: [{
      id: "session-2",
      task_id: "task-2",
      task_title: null,
      starts_at: "2026-10-01T10:00:00Z",
      ends_at: "2026-10-01T11:00:00Z",
      planned_duration_minutes: 60,
    }],
    task_allocations: [{
      task_id: "task-2",
      task_title: null,
      deadline_at: "2026-10-02T12:00:00Z",
      required_minutes: 120,
      scheduled_minutes: 60,
      unscheduled_minutes: 60,
      raw_calendar_capacity_minutes: 60,
      available_minutes_before_deadline: 60,
      shortfall_minutes: 60,
    }],
    unscheduled_work: [{
      task_id: "task-2",
      task_title: null,
      required_minutes: 60,
      available_minutes_before_deadline: 60,
      shortfall_minutes: 0,
      unscheduled_minutes: 60,
    }],
    overload_warning: null,
    scenario: {
      temporary_availability: [{ starts_at: "2026-10-01T09:00:00Z", ends_at: "2026-10-01T10:00:00Z" }],
      temporary_blocked_periods: [
        { starts_at: "2026-10-01T12:00:00Z", ends_at: "2026-10-01T13:00:00Z", reason: null },
        { starts_at: "2026-10-01T14:00:00Z", ends_at: "2026-10-01T15:00:00Z", reason: "Class" },
      ],
      deadline_overrides: [{ task_id: "task-2", deadline_at: "2026-10-03T12:00:00Z" }],
    },
  };

  expect(toScheduleProposal(proposal)).toMatchObject({
    reason: "Your plan needs updating.",
    proposedSessions: [{ taskTitle: "Untitled task" }],
    unscheduledWork: [{ taskTitle: "Untitled task", reason: "It could not be placed in the time available." }],
    overloadWarnings: [{ taskTitle: "Untitled task", remedies: ["extend_deadline", "add_availability"] }],
    scenario: {
      temporaryAvailability: [{ startsAt: "2026-10-01T09:00:00Z" }],
      temporaryBlockedPeriods: [
        { startsAt: "2026-10-01T12:00:00Z", endsAt: "2026-10-01T13:00:00Z" },
        { startsAt: "2026-10-01T14:00:00Z", endsAt: "2026-10-01T15:00:00Z", reason: "Class" },
      ],
      deadlineOverrides: [{ taskId: "task-2" }],
    },
  });
});

it("maps server effort progress into the UI vocabulary", () => {
  expect(toEffortProgress({
    task_id: "task-1",
    task_title: "Read",
    actual_duration_minutes: 30,
    estimated_remaining_minutes: 60,
    effort_percent: 33,
    sessions_completed: 1,
    sessions_upcoming: 2,
    status: "in_progress",
  })).toEqual({
    taskId: "task-1",
    taskTitle: "Read",
    actualDuration: 30,
    estimatedRemaining: 60,
    effortPercent: 33,
    sessionsCompleted: 1,
    sessionsUpcoming: 2,
    status: "In Progress",
  });
});
