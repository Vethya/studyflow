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

it("guards dirty window changes, handles save failures, and resets on reopen", async () => {
  const onSubmit = vi.fn().mockRejectedValueOnce(new Error("window failed"));
  const onOpenChange = vi.fn();
  const { rerender } = render(<AddWindowDialog open onOpenChange={onOpenChange} onSubmit={onSubmit} />);
  fireEvent.change(screen.getByLabelText("Start"), { target: { value: "19:00" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(await screen.findByRole("button", { name: "Discard changes" }));
  expect(onOpenChange).toHaveBeenCalledWith(false);

  rerender(<AddWindowDialog open onOpenChange={onOpenChange} onSubmit={onSubmit} />);
  fireEvent.click(screen.getByRole("button", { name: "Add window" }));
  expect(await screen.findByText("window failed")).toBeTruthy();
});

it("seeds and saves an edited exception, including a failed save and discard", async () => {
  const period = { id: "p", title: "Exam", startDate: "2026-10-02T02:00:00.000Z", endDate: "2026-10-02T05:00:00.000Z", reason: "Exam" };
  const onSubmit = vi.fn().mockRejectedValueOnce(new Error("exception failed"));
  const onOpenChange = vi.fn();
  const { rerender } = render(<ExceptionDialog open period={period} onOpenChange={onOpenChange} onSubmit={onSubmit} />);
  expect((screen.getByLabelText("Reason (optional)") as HTMLInputElement).value).toBe("Exam");
  fireEvent.change(screen.getByLabelText("Reason (optional)"), { target: { value: "Changed" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(await screen.findByRole("button", { name: "Discard changes" }));
  expect(onOpenChange).toHaveBeenCalledWith(false);

  rerender(<ExceptionDialog open period={period} onOpenChange={onOpenChange} onSubmit={onSubmit} />);
  fireEvent.change(screen.getByLabelText("Reason (optional)"), { target: { value: "Changed" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ reason: "Changed" }));
  expect(await screen.findByText("exception failed")).toBeTruthy();
});

it("covers clean closes and repeated dirty close requests", async () => {
  const closed = vi.fn();
  render(<AddWindowDialog open onOpenChange={closed} onSubmit={vi.fn()} />);
  screen.getByRole("button", { name: "Cancel" }).click();
  expect(closed).toHaveBeenCalledWith(false);

  cleanup();
  const dirtyClosed = vi.fn();
  render(<AddWindowDialog open onOpenChange={dirtyClosed} onSubmit={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Start"), { target: { value: "19:00" } });
  screen.getByRole("button", { name: "Cancel" }).click();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(dirtyClosed).not.toHaveBeenCalled();

  cleanup();
  const exceptionClosed = vi.fn();
  render(<ExceptionDialog open onOpenChange={exceptionClosed} onSubmit={vi.fn()} />);
  screen.getByRole("button", { name: "Cancel" }).click();
  expect(exceptionClosed).toHaveBeenCalledWith(false);

  cleanup();
  const dirtyExceptionClosed = vi.fn();
  render(<ExceptionDialog open onOpenChange={dirtyExceptionClosed} onSubmit={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Reason (optional)"), { target: { value: "Trip" } });
  screen.getByRole("button", { name: "Cancel" }).click();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(dirtyExceptionClosed).not.toHaveBeenCalled();
});

it("resets reopened forms, changes the weekday, and handles non-Error failures", async () => {
  const onSubmit = vi.fn().mockRejectedValueOnce("window failed without an Error");
  const onOpenChange = vi.fn();
  const view = render(<AddWindowDialog open={false} onOpenChange={onOpenChange} onSubmit={onSubmit} />);
  view.rerender(<AddWindowDialog open onOpenChange={onOpenChange} onSubmit={onSubmit} />);
  const day = screen.getByRole("combobox");
  fireEvent.mouseDown(day);
  await waitFor(() => expect(screen.getByText("Friday")).toBeTruthy());
  fireEvent.click(screen.getByText("Friday"));
  fireEvent.click(screen.getByRole("button", { name: "Add window" }));
  expect(await screen.findByText("Could not save the window.")).toBeTruthy();

  cleanup();
  const exceptionSubmit = vi.fn().mockRejectedValueOnce("exception failed without an Error");
  render(<ExceptionDialog open onOpenChange={onOpenChange} onSubmit={exceptionSubmit} />);
  fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-10-02T09:00" } });
  fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "2026-10-02T10:00" } });
  fireEvent.click(screen.getByRole("button", { name: "Add exception" }));
  expect(await screen.findByText("Could not save the exception.")).toBeTruthy();
});
