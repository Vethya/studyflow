// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { acceptProposalMock, rejectProposalMock, errorToastMock, successToastMock } = vi.hoisted(() => ({
  acceptProposalMock: vi.fn(),
  rejectProposalMock: vi.fn(),
  errorToastMock: vi.fn(),
  successToastMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  scheduling: {
    acceptProposal: acceptProposalMock,
    rejectProposal: rejectProposalMock,
    listSessions: vi.fn(),
  },
}));

vi.mock("@/hooks/use-api", () => ({
  useApi: (_key: unknown, loader?: (signal: AbortSignal) => unknown) => {
    if (loader) void loader(new AbortController().signal);
    return { data: undefined, error: null, isLoading: false };
  },
  describeError: (error: unknown) => String(error),
}));

vi.mock("@/hooks/use-account-timezone", () => ({
  useAccountTimezone: () => "UTC",
}));

vi.mock("sonner", () => ({
  toast: { success: successToastMock, error: errorToastMock },
}));

import { PendingPlanBanner, ProposalCalendar, SchedulePreview } from "./schedule-preview";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  acceptProposalMock.mockReset();
  rejectProposalMock.mockReset();
  errorToastMock.mockReset();
  successToastMock.mockReset();
});

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

const proposal = {
  id: "proposal-1",
  proposedSessions: [
    {
      id: "session-1",
      taskId: "task-1",
      taskTitle: "Algebra review",
      category: "Assignment" as const,
      startTime: "2099-09-14T09:00:00Z",
      endTime: "2099-09-14T10:00:00Z",
      plannedDuration: 60,
      isAwaitingOutcome: false,
    },
  ],
  unscheduledWork: [],
  overloadWarnings: [],
  createdAt: "2099-09-01T09:00:00Z",
};

it("shows the proposed work and accepts the whole plan", async () => {
  acceptProposalMock.mockResolvedValue(undefined);
  const onAccepted = vi.fn();
  const onOpenChange = vi.fn();

  render(
    <SchedulePreview
      proposal={proposal}
      open
      onOpenChange={onOpenChange}
      onAccepted={onAccepted}
      onRejected={vi.fn()}
    />,
  );

  expect(screen.getByText("Your proposed plan")).toBeTruthy();
  expect(screen.getByText("Algebra review")).toBeTruthy();
  expect(screen.getByText(/Using this plan replaces all of your upcoming sessions/i)).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Use this plan" }));

  await waitFor(() => expect(acceptProposalMock).toHaveBeenCalledWith("proposal-1", undefined, false));
  expect(onAccepted).toHaveBeenCalledOnce();
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it("discards a proposal without accepting it", async () => {
  rejectProposalMock.mockResolvedValue(undefined);
  const onRejected = vi.fn();
  const onOpenChange = vi.fn();

  render(
    <SchedulePreview
      proposal={proposal}
      open
      onOpenChange={onOpenChange}
      onAccepted={vi.fn()}
      onRejected={onRejected}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Discard" }));

  await waitFor(() => expect(rejectProposalMock).toHaveBeenCalledWith("proposal-1"));
  expect(onRejected).toHaveBeenCalledOnce();
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it("renders recovery assumptions, recorded history, overloads, and navigation", async () => {
  const session = (id: string, start: string, outcome?: "Missed" | "Delayed" | "Completed") => ({
    id, taskId: id, taskTitle: `Task ${id}`, category: "Reading" as const,
    startTime: start, endTime: new Date(new Date(start).getTime() + 3_600_000).toISOString(),
    plannedDuration: 60, actualDuration: outcome === "Delayed" ? 30 : undefined, outcome,
    isAwaitingOutcome: false,
  });
  const recovery = {
    ...proposal,
    reason: "Availability changed",
    scenario: {
      temporaryAvailability: [{ startsAt: "2099-09-14T09:00:00Z", endsAt: "2099-09-14T10:00:00Z" }, { startsAt: "2099-09-15T09:00:00Z", endsAt: "2099-09-15T10:00:00Z" }],
      temporaryBlockedPeriods: [{ startsAt: "2099-09-16T09:00:00Z", endsAt: "2099-09-16T10:00:00Z" }, { startsAt: "2099-09-17T09:00:00Z", endsAt: "2099-09-17T10:00:00Z" }],
      deadlineOverrides: [{ taskId: "task-1", deadline: "2099-09-20T00:00:00Z" }, { taskId: "task-2", deadline: "2099-09-21T00:00:00Z" }],
    },
    proposedSessions: Array.from({ length: 6 }, (_, index) => session(`new-${index}`, `2099-09-${14 + index}T09:00:00Z`)),
    unscheduledWork: [{ taskId: "overload", taskTitle: "Overloaded", remainingMinutes: 90, reason: "No slot" }, { taskId: "unexplained", taskTitle: "Unplaced", remainingMinutes: 30, reason: "No room" }],
    overloadWarnings: [{ taskId: "overload", taskTitle: "Overloaded", deadline: "2099-09-20T00:00:00Z", requiredMinutes: 90, availableMinutes: 0, shortfallMinutes: 90, remedies: ["add_availability"], relevantUnavailablePeriods: [] }],
  } as any;
  const existing = [
    session("old-1", "2099-09-14T11:00:00Z"), session("old-2", "2099-09-15T11:00:00Z"),
    session("old-3", "2099-09-16T11:00:00Z"), session("old-4", "2099-09-17T11:00:00Z"),
    session("old-5", "2099-09-18T11:00:00Z"), session("old-6", "2099-09-19T11:00:00Z"),
    session("missed", "2099-09-20T11:00:00Z", "Missed"), session("delayed", "2099-09-21T11:00:00Z", "Delayed"), session("done", "2099-09-18T11:00:00Z", "Completed"),
  ];
  const { rerender } = render(<SchedulePreview proposal={null} open={false} onOpenChange={vi.fn()} onAccepted={vi.fn()} onRejected={vi.fn()} />);
  rerender(<SchedulePreview proposal={recovery} existingSessions={existing as any} availabilityWindows={[]} unavailablePeriods={[]} open onOpenChange={vi.fn()} onAccepted={vi.fn()} onRejected={vi.fn()} />);
  expect(screen.getByText("A new plan for you")).toBeTruthy();
  expect(screen.getByText(/temporary study windows/)).toBeTruthy();
  expect(screen.getByText("Why this changed")).toBeTruthy();
  expect(screen.getByText(/Schedule adjustment summary/)).toBeTruthy();
  expect(screen.getByText(/and 1 more upcoming session/)).toBeTruthy();
  expect(screen.getByText(/1 task still doesn’t fit/)).toBeTruthy();
  expect(screen.getByText("Unplaced")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Next week" }));
  fireEvent.click(screen.getByRole("button", { name: "Previous week" }));

  rejectProposalMock.mockRejectedValueOnce(new Error("reject failed"));
  fireEvent.click(screen.getByRole("button", { name: "Discard" }));
  await waitFor(() => expect(errorToastMock).toHaveBeenCalledWith("Error: reject failed"));
});

it("covers empty and ranged calendar states plus the pending-plan banner", () => {
  const onReview = vi.fn();
  render(<PendingPlanBanner proposal={{ ...proposal, reason: undefined }} onReview={onReview} />);
  fireEvent.click(screen.getByRole("button", { name: "Review it" }));
  expect(onReview).toHaveBeenCalledOnce();
  cleanup();

  const old = { ...proposal, proposedSessions: [], unscheduledWork: [], overloadWarnings: [] };
  render(
    <SchedulePreview
      proposal={old}
      existingSessions={[]}
      availabilityWindows={[]}
      unavailablePeriods={[]}
      open
      onOpenChange={vi.fn()}
      onAccepted={vi.fn()}
      onRejected={vi.fn()}
    />,
  );
  expect(screen.getByText("Your proposed plan")).toBeTruthy();
  const recoverySession = { ...proposal.proposedSessions[0], id: "recovery-1", taskTitle: "Recovery one" };
  const secondRecoverySession = { ...recoverySession, id: "recovery-2", taskTitle: "Recovery two" };
  render(
    <SchedulePreview
      proposal={{ ...proposal, reason: "Recovery", proposedSessions: [recoverySession, secondRecoverySession] }}
      existingSessions={[]}
      open
      onOpenChange={vi.fn()}
      onAccepted={vi.fn()}
      onRejected={vi.fn()}
    />,
  );
  expect(screen.getByText(/2 newly proposed recovery sessions/)).toBeTruthy();
});

it("renders calendar capacity, recorded outcomes, and empty defaults", () => {
  render(
    <ProposalCalendar
      isRecoveryProposal
      proposedSessions={[]}
      recordedSessions={[]}
      availabilityWindows={[]}
      unavailablePeriods={[]}
    />,
  );
  expect(screen.getByRole("region", { name: "Proposed sessions" })).toBeTruthy();
  cleanup();

  render(
    <ProposalCalendar
      isRecoveryProposal={false}
      proposedSessions={[]}
      recordedSessions={[{ id: "current", taskId: "task", taskTitle: "Current", category: "Reading", startTime: new Date(Date.now() + 3_600_000).toISOString(), endTime: new Date(Date.now() + 7_200_000).toISOString(), plannedDuration: 60, outcome: "Completed", isAwaitingOutcome: false } as any]}
    />,
  );
  cleanup();

  render(
    <ProposalCalendar
      isRecoveryProposal={false}
      proposedSessions={[]}
      recordedSessions={[{ id: "old", taskId: "task", taskTitle: "Old", category: "Reading", startTime: "2099-09-14T09:00:00Z", endTime: "2099-09-14T10:00:00Z", plannedDuration: 60, isAwaitingOutcome: false } as any]}
    />,
  );
  cleanup();

  const session = {
    id: "calendar-session",
    taskId: "task-1",
    taskTitle: "Calendar task",
    category: "Assignment" as const,
    startTime: "2099-09-14T09:00:00Z",
    endTime: "2099-09-14T10:00:00Z",
    plannedDuration: 60,
    actualDuration: 30,
    outcome: "Delayed" as const,
    isAwaitingOutcome: false,
  };
  render(
    <ProposalCalendar
      isRecoveryProposal={false}
      proposedSessions={[{ ...session, id: "proposed", outcome: undefined }] as any}
      recordedSessions={[session as any]}
      availabilityWindows={[{ id: "window", dayOfWeek: 1, startTime: "08:00", endTime: "12:00" }]}
      unavailablePeriods={[{ id: "blocked", title: "Exam", startDate: "2099-09-14T10:00:00Z", endDate: "2099-09-14T11:00:00Z" }]}
    />,
  );
  expect(screen.getAllByText("Calendar task").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "Next week" }));
  fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
});

it("covers singular scenario labels, recovery summaries, and midnight capacity", () => {
  const one = {
    id: "single",
    taskId: "task-single",
    taskTitle: "Single recovery",
    category: "Reading" as const,
    startTime: "2099-09-14T09:00:00Z",
    endTime: "2099-09-14T10:00:00Z",
    plannedDuration: 60,
    isAwaitingOutcome: false,
  };
  const singular = {
    ...proposal,
    reason: "One adjustment",
    proposedSessions: [one],
    scenario: {
      temporaryAvailability: [{ startsAt: one.startTime, endsAt: one.endTime }],
      temporaryBlockedPeriods: [{ startsAt: one.startTime, endsAt: one.endTime }],
      deadlineOverrides: [{ taskId: one.taskId, deadline: one.endTime }],
    },
  } as any;
  const active = { ...one, id: "active", taskId: "active", taskTitle: "Active session" };
  const missed = { ...one, id: "missed", outcome: "Missed" as const };
  const delayed = { ...one, id: "delayed", outcome: "Delayed" as const, actualDuration: 30 };
  render(<SchedulePreview proposal={singular} existingSessions={[active, missed, delayed] as any} availabilityWindows={[]} unavailablePeriods={[]} open onOpenChange={vi.fn()} onAccepted={vi.fn()} onRejected={vi.fn()} />);
  expect(screen.getByText(/1 temporary study window/)).toBeTruthy();
  expect(screen.getByText(/1 temporary block/)).toBeTruthy();
  expect(screen.getByText(/1 hypothetical deadline/)).toBeTruthy();
  expect(screen.getByText(/1 upcoming session/)).toBeTruthy();
  expect(screen.getByText(/1 newly proposed recovery session/)).toBeTruthy();
  cleanup();

  render(<SchedulePreview proposal={singular} existingSessions={[missed, delayed] as any} availabilityWindows={[]} unavailablePeriods={[]} open onOpenChange={vi.fn()} onAccepted={vi.fn()} onRejected={vi.fn()} />);
  expect(screen.getByText(/will add/)).toBeTruthy();
  cleanup();

  render(<PendingPlanBanner proposal={{ ...proposal, reason: "Needs updating" } as any} onReview={vi.fn()} />);
  expect(screen.getByText("Your plan needs updating")).toBeTruthy();
  cleanup();

  render(<ProposalCalendar isRecoveryProposal={false} proposedSessions={[]} recordedSessions={[{ ...one, id: "old-calendar", startTime: "2025-09-14T23:00:00Z", endTime: "2025-09-15T00:00:00Z" } as any]} availabilityWindows={[{ id: "overnight", dayOfWeek: 0, startTime: "23:00", endTime: "00:00" }]} unavailablePeriods={[]} />);
  expect(screen.getByRole("region", { name: "Proposed sessions" })).toBeTruthy();
});

it("covers empty scenario assumptions and plural recovery summaries", () => {
  const makeSession = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    taskId: id,
    taskTitle: `Task ${id}`,
    category: "Reading" as const,
    startTime: "2099-09-14T09:00:00Z",
    endTime: "2099-09-14T10:00:00Z",
    plannedDuration: 60,
    isAwaitingOutcome: false,
    ...overrides,
  });
  const active = Array.from({ length: 7 }, (_, index) => makeSession(`active-${index}`, {
    taskTitle: index === 0 ? undefined : `Active ${index}`,
    startTime: `2099-09-${14 + index}T09:00:00Z`,
    endTime: `2099-09-${14 + index}T10:00:00Z`,
  }));
  const recovery = {
    ...proposal,
    reason: "Several adjustments",
    proposedSessions: [makeSession("new-1"), makeSession("new-2")],
    scenario: { temporaryAvailability: [], temporaryBlockedPeriods: [], deadlineOverrides: [] },
    overloadWarnings: [
      { taskId: "over-1", taskTitle: "Over one", deadline: "2099-09-20T00:00:00Z", requiredMinutes: 30, availableMinutes: 0, shortfallMinutes: 30, remedies: [], relevantUnavailablePeriods: [] },
      { taskId: "over-2", taskTitle: "Over two", deadline: "2099-09-20T00:00:00Z", requiredMinutes: 30, availableMinutes: 0, shortfallMinutes: 30, remedies: [], relevantUnavailablePeriods: [] },
    ],
  } as any;
  render(<SchedulePreview proposal={recovery} existingSessions={active as any} availabilityWindows={[]} unavailablePeriods={[]} open onOpenChange={vi.fn()} onAccepted={vi.fn()} onRejected={vi.fn()} />);
  expect(screen.getByText(/7 upcoming sessions/)).toBeTruthy();
  expect(screen.getByText(/and 2 more upcoming sessions/)).toBeTruthy();
  expect(screen.getByText(/2 tasks still don’t fit/)).toBeTruthy();

  cleanup();
  const delayed = makeSession("delayed", { outcome: "Delayed", actualDuration: undefined });
  render(<ProposalCalendar isRecoveryProposal={false} proposedSessions={[]} recordedSessions={[{ ...delayed, startTime: "2026-09-29T23:00:00Z", endTime: "2026-09-30T00:00:00Z" } as any]} availabilityWindows={[]} unavailablePeriods={[]} />);
  expect(screen.getByRole("region", { name: "Proposed sessions" })).toBeTruthy();
});
