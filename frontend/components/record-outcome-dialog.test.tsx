// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { recordOutcomeMock, successToastMock } = vi.hoisted(() => ({
  recordOutcomeMock: vi.fn(),
  successToastMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ scheduling: { recordOutcome: recordOutcomeMock } }));
vi.mock("@/hooks/use-account-timezone", () => ({ useAccountTimezone: () => "Asia/Phnom_Penh" }));
vi.mock("sonner", () => ({ toast: { success: successToastMock, error: vi.fn() } }));

import { RecordOutcomeDialog } from "./record-outcome-dialog";

afterEach(() => {
  cleanup();
  recordOutcomeMock.mockReset();
  successToastMock.mockReset();
});

const session = {
  id: "session-1",
  taskId: "task-1",
  taskTitle: "Read chapter",
  category: "Reading" as const,
  startTime: "2026-10-01T18:00:00+07:00",
  endTime: "2026-10-01T19:00:00+07:00",
  plannedDuration: 60,
  isAwaitingOutcome: true,
};

const result = {
  session: { ...session, outcome: "Missed" as const },
  revision: null,
};

function renderDialog() {
  const onOpenChange = vi.fn();
  const onRecorded = vi.fn();
  render(
    <RecordOutcomeDialog
      session={session}
      open
      onOpenChange={onOpenChange}
      onRecorded={onRecorded}
    />,
  );
  return { onOpenChange, onRecorded };
}

it("records a missed session with the full planned work", async () => {
  recordOutcomeMock.mockResolvedValue(result);
  const { onOpenChange, onRecorded } = renderDialog();

  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(recordOutcomeMock).toHaveBeenCalledWith(
    "session-1",
    { outcome: "Missed", actualMinutes: 0, revisedRemainingMinutes: undefined, largeActualConfirmed: false },
    undefined,
    "Read chapter",
  ));
  expect(onRecorded).toHaveBeenCalledWith(result);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it("requires positive worked and remaining minutes for a delayed outcome", async () => {
  recordOutcomeMock.mockResolvedValue({ ...result, session: { ...session, outcome: "Delayed" } });
  renderDialog();

  fireEvent.click(screen.getByRole("button", { name: /Partly done/ }));
  fireEvent.change(screen.getByLabelText("Minutes you worked"), { target: { value: "40" } });
  fireEvent.change(screen.getByLabelText("Minutes still left"), { target: { value: "20" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(recordOutcomeMock).toHaveBeenCalledWith(
    "session-1",
    { outcome: "Delayed", actualMinutes: 40, revisedRemainingMinutes: 20, largeActualConfirmed: false },
    undefined,
    "Read chapter",
  ));
});

it("asks for confirmation before recording an unusually large actual duration", async () => {
  recordOutcomeMock.mockResolvedValue({ ...result, session: { ...session, outcome: "Completed" } });
  renderDialog();

  fireEvent.click(screen.getByRole("button", { name: /Finished it/ }));
  fireEvent.change(screen.getByLabelText("Minutes you worked"), { target: { value: "200" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(await screen.findByText("That is a lot longer than planned")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Yes, save it" }));

  await waitFor(() => expect(recordOutcomeMock).toHaveBeenCalledWith(
    "session-1",
    { outcome: "Completed", actualMinutes: 200, revisedRemainingMinutes: undefined, largeActualConfirmed: true },
    undefined,
    "Read chapter",
  ));
});
