// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const cancel = vi.hoisted(() => vi.fn());
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, onOpenChange, children }: any) => open ? <div role="dialog"><button onClick={() => onOpenChange?.(true)}>Open event</button><button onClick={() => onOpenChange?.(false, { cancel })}>Close event</button>{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <footer>{children}</footer>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));
vi.mock("@/components/ui/confirm-dialog", () => ({
  ConfirmDialog: ({ open, onConfirm }: any) => open ? <button onClick={onConfirm}>Discard changes</button> : null,
}));
vi.mock("@/lib/api", () => ({ scheduling: { recordOutcome: vi.fn() } }));
vi.mock("@/hooks/use-api", () => ({ describeError: (error: unknown) => String(error) }));
vi.mock("@/hooks/use-account-timezone", () => ({ useAccountTimezone: () => "UTC" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { RecordOutcomeDialog } from "./record-outcome-dialog";

const session = {
  id: "session-events",
  taskId: "task-events",
  taskTitle: "Read events",
  category: "Reading" as const,
  startTime: "2099-09-12T09:00:00Z",
  endTime: "2099-09-12T10:00:00Z",
  plannedDuration: 60,
  isAwaitingOutcome: true,
};

afterEach(() => cleanup());

it("covers record outcome dialog root open/close events", () => {
  const changed = vi.fn();
  render(<RecordOutcomeDialog session={session} open onOpenChange={changed} onRecorded={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Open event" }));
  fireEvent.click(screen.getByRole("button", { name: "Close event" }));
  expect(changed).toHaveBeenNthCalledWith(1, true);
  expect(changed).toHaveBeenNthCalledWith(2, false);

  cleanup();
  cancel.mockClear();
  const dirtyChanged = vi.fn();
  render(<RecordOutcomeDialog session={session} open onOpenChange={dirtyChanged} onRecorded={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /Finished it/ }));
  fireEvent.click(screen.getByRole("button", { name: "Close event" }));
  expect(cancel).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(dirtyChanged).toHaveBeenCalledWith(false);

  cleanup();
  cancel.mockClear();
  render(<RecordOutcomeDialog session={session} open onOpenChange={vi.fn()} onRecorded={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /Finished it/ }));
  fireEvent.change(screen.getByLabelText("Minutes you worked"), { target: { value: "200" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  fireEvent.click(screen.getByRole("button", { name: "Close event" }));
  expect(cancel).toHaveBeenCalled();
});
