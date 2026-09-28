// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/hooks/use-account-timezone", () => ({
  useAccountTimezone: () => "Asia/Phnom_Penh",
}));

import { AddWindowDialog, ExceptionDialog } from "./availability-dialogs";

afterEach(() => cleanup());

it("submits a recurring availability window and closes after saving", async () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onOpenChange = vi.fn();

  render(<AddWindowDialog open onOpenChange={onOpenChange} onSubmit={onSubmit} />);
  fireEvent.click(screen.getByRole("button", { name: "Add window" }));

  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
    dayOfWeek: 1,
    startTime: "18:00",
    endTime: "21:00",
  }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it("rejects an availability window whose start and end are identical", async () => {
  const onSubmit = vi.fn();
  render(<AddWindowDialog open onOpenChange={() => {}} onSubmit={onSubmit} />);

  fireEvent.change(screen.getByLabelText("End"), { target: { value: "18:00" } });
  fireEvent.click(screen.getByRole("button", { name: "Add window" }));

  expect(await screen.findByText("Start and end times must differ.")).toBeTruthy();
  expect(onSubmit).not.toHaveBeenCalled();
});

it("converts an unavailable period form into timezone-aware API values", async () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onOpenChange = vi.fn();

  render(<ExceptionDialog open onOpenChange={onOpenChange} onSubmit={onSubmit} />);
  fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-10-02T09:00" } });
  fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "2026-10-02T12:00" } });
  fireEvent.change(screen.getByLabelText("Reason (optional)"), { target: { value: "Exam" } });
  fireEvent.click(screen.getByRole("button", { name: "Add exception" }));

  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
    startsAt: "2026-10-02T02:00:00.000Z",
    endsAt: "2026-10-02T05:00:00.000Z",
    reason: "Exam",
  }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it("shows an error instead of submitting an exception that ends first", async () => {
  const onSubmit = vi.fn();
  render(<ExceptionDialog open onOpenChange={() => {}} onSubmit={onSubmit} />);

  fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-10-02T12:00" } });
  fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "2026-10-02T09:00" } });
  fireEvent.click(screen.getByRole("button", { name: "Add exception" }));

  expect(await screen.findByText("The end must come after the start.")).toBeTruthy();
  expect(onSubmit).not.toHaveBeenCalled();
});
