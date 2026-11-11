import { expect, it } from "vitest";
import { toScheduleProposal } from "./mappers";
import type { WireScheduleProposal } from "./wire";

const allocation = (taskId: string, deadline: string, shortfall: number) => ({
  task_id: taskId,
  task_title: `Task ${taskId}`,
  deadline_at: deadline,
  required_minutes: 300,
  scheduled_minutes: 300 - shortfall,
  unscheduled_minutes: shortfall,
  raw_calendar_capacity_minutes: 400,
  available_minutes_before_deadline: 300 - shortfall,
  shortfall_minutes: shortfall,
});

const wire: WireScheduleProposal = {
  id: "proposal-1",
  kind: "generation",
  revision_reason: null,
  status: "overload",
  created_at: "2026-09-14T00:00:00Z",
  sessions: [],
  task_allocations: [
    allocation("early", "2026-09-16T12:00:00Z", 60),
    allocation("late", "2026-09-30T12:00:00Z", 90),
    allocation("fits", "2026-09-20T12:00:00Z", 0),
  ],
  unscheduled_work: [],
  overload_warning: {
    affected_tasks: [],
    relevant_unavailable_periods: [
      { id: "trip", starts_at: "2026-09-15T00:00:00Z", ends_at: "2026-09-17T00:00:00Z", reason: "Trip" },
      { id: "exam", starts_at: "2026-09-25T00:00:00Z", ends_at: "2026-09-25T06:00:00Z", reason: null },
    ],
    remedies: ["extend_deadline", "add_availability"],
  },
  scenario: null,
};

it("keeps the full SPEC §10.5 explanation per overloaded task", () => {
  const { overloadWarnings } = toScheduleProposal(wire);

  expect(overloadWarnings.map((warning) => warning.taskId)).toEqual(["early", "late"]);
  expect(overloadWarnings[0]).toMatchObject({
    deadline: "2026-09-16T12:00:00Z",
    requiredMinutes: 300,
    availableMinutes: 240,
    shortfallMinutes: 60,
    remedies: ["extend_deadline", "add_availability"],
  });
});

it("only attaches unavailable periods that start before each task's deadline", () => {
  const [early, late] = toScheduleProposal(wire).overloadWarnings;

  expect(early.relevantUnavailablePeriods).toEqual([
    { id: "trip", startsAt: "2026-09-15T00:00:00Z", endsAt: "2026-09-17T00:00:00Z", reason: "Trip" },
  ]);
  expect(late.relevantUnavailablePeriods.map((period) => period.id)).toEqual(["trip", "exam"]);
  expect(late.relevantUnavailablePeriods[1].reason).toBeUndefined();
});
