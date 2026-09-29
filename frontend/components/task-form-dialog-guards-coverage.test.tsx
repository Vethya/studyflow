// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const estimate = {
  category: "Other",
  originalEstimate: 61,
  adaptiveEstimate: 155,
  plannedDuration: 155,
  factor: 2.5,
  needsAcknowledgment: true,
  isCategorySpecific: true,
  historyCount: 4,
};

vi.mock("swr", () => ({
  default: (_key: unknown, _fetcher: unknown, options: { onSuccess?: (value: typeof estimate) => void }) => {
    const called = React.useRef(false);
    React.useEffect(() => {
      if (!called.current) {
        called.current = true;
        options.onSuccess?.(estimate);
      }
    }, []);
    return {
      data: estimate,
      error: null,
      mutate: vi.fn((updater?: (current: typeof estimate | undefined) => unknown) => updater?.(undefined)),
    };
  },
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, onOpenChange, children }: any) => open ? <div role="dialog"><button type="button" onClick={() => onOpenChange?.(false, { cancel: vi.fn() })}>Close parent</button>{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <footer>{children}</footer>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));
vi.mock("@/components/ui/confirm-dialog", () => ({ ConfirmDialog: ({ open, onConfirm }: any) => open ? <button type="button" onClick={onConfirm}>Discard changes</button> : null }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children, ...props }: any) => <button type="button" {...props}>{children}</button>,
  SelectValue: ({ children }: any) => <span>{children}</span>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <span>{children}</span>,
}));
vi.mock("@/components/adaptive-estimate", () => ({
  AdaptiveEstimateNote: () => null,
  PersistedEstimateNote: () => null,
  LargeAdjustmentDialog: ({ open, onDecided }: any) => open ? <button type="button" onClick={() => onDecided("adaptive")}>Use suggestion</button> : null,
}));
vi.mock("@/hooks/use-account-timezone", () => ({ useAccountTimezone: () => "UTC" }));
vi.mock("@/hooks/use-api", () => ({ describeError: (error: unknown) => error instanceof Error ? error.message : "Unknown error" }));
vi.mock("@/lib/api", () => ({ ApiError: class ApiError extends Error {}, tasks: {}, scheduling: {} }));

import { TaskFormDialog } from "./task-form-dialog";

afterEach(cleanup);

const task = {
  id: "task-1",
  title: "Assignment",
  category: "Other",
  priority: "Medium",
  deadline: "2099-09-12T09:00:00Z",
  originalEstimate: 61,
  plannedSource: "Adaptive",
  plannedDuration: 155,
  estimateFrozen: false,
  course: "Course",
  notes: "Notes",
  actualDuration: 0,
  remainingDuration: 155,
  adaptiveEstimate: 155,
  status: "Not Started",
  sessionsCompleted: 0,
  sessionsUpcoming: 0,
  createdAt: "2099-09-01T00:00:00Z",
  updatedAt: "2099-09-01T00:00:00Z",
} as any;

it("covers the guarded preview callback, close guard, and empty mutate cache", async () => {
  render(<TaskFormDialog open task={task} onOpenChange={vi.fn()} onSaved={vi.fn()} />);
  fireEvent.submit(screen.getByRole("button", { name: "Save changes" }).closest("form")!);
  await waitFor(() => expect(screen.getByRole("button", { name: "Use suggestion" })).toBeTruthy());
  screen.getByRole("button", { name: "Close parent" }).click();
  screen.getByRole("button", { name: "Use suggestion" }).click();

  cleanup();
  render(<TaskFormDialog open task={{ ...task, estimateFrozen: true }} onOpenChange={vi.fn()} onSaved={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy());
});
