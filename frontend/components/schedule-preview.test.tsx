// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { acceptProposalMock, rejectProposalMock } = vi.hoisted(() => ({
  acceptProposalMock: vi.fn(),
  rejectProposalMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  scheduling: {
    acceptProposal: acceptProposalMock,
    rejectProposal: rejectProposalMock,
    listSessions: vi.fn(),
  },
}));

vi.mock("@/hooks/use-api", () => ({
  useApi: () => ({ data: undefined, error: null, isLoading: false }),
  describeError: (error: unknown) => String(error),
}));

vi.mock("@/hooks/use-account-timezone", () => ({
  useAccountTimezone: () => "UTC",
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { SchedulePreview } from "./schedule-preview";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  acceptProposalMock.mockReset();
  rejectProposalMock.mockReset();
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
