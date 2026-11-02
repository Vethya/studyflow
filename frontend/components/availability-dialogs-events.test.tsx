// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const cancel = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-account-timezone", () => ({ useAccountTimezone: () => "UTC" }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, onOpenChange, children }: any) => open ? <div role="dialog"><button onClick={() => onOpenChange?.(true)}>Dialog open event</button><button onClick={() => onOpenChange?.(false, { cancel })}>Dialog close event</button>{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <footer>{children}</footer>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));
vi.mock("@/components/ui/confirm-dialog", () => ({
  ConfirmDialog: ({ open, onOpenChange, onConfirm }: any) => open ? <div role="alertdialog"><button onClick={() => onOpenChange?.(false)}>Keep editing</button><button onClick={() => void onConfirm()}>Discard changes</button></div> : null,
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ onValueChange, children }: any) => <div><button type="button" onClick={() => onValueChange?.("")}>Select empty</button><button type="button" onClick={() => onValueChange?.("2")}>Select Tuesday</button><button type="button" onClick={() => onValueChange?.("5")}>Select Friday</button>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <span>{children}</span>,
  SelectTrigger: ({ children }: any) => <button type="button">{children}</button>,
  SelectValue: ({ children }: any) => <span>{typeof children === "function" ? children("1") : children}</span>,
}));

import { AddWindowDialog, ExceptionDialog } from "./availability-dialogs";

afterEach(cleanup);

const startValue = () => (screen.getByLabelText("Start") as HTMLInputElement).value;

it("re-suggests free times on a day change until the student picks times", async () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const existing = [{ dayOfWeek: 5, startTime: "18:00", endTime: "21:00" }];
  render(<AddWindowDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} existing={existing} />);
  expect(startValue()).toBe("18:00");
  fireEvent.click(screen.getByRole("button", { name: "Select Friday" }));
  expect(startValue()).toBe("09:00");
  fireEvent.click(screen.getByRole("button", { name: "Select Tuesday" }));
  expect(startValue()).toBe("18:00");

  fireEvent.change(screen.getByLabelText("Start"), { target: { value: "19:00" } });
  fireEvent.click(screen.getByRole("button", { name: "Select Friday" }));
  expect(startValue()).toBe("19:00");
  fireEvent.click(screen.getByRole("button", { name: "Add study hours" }));
  expect(await screen.findByText("Friday already has study hours from 18:00 to 21:00, which cover this time.")).toBeTruthy();
  expect(onSubmit).not.toHaveBeenCalled();
});

it("keeps an edited window's times when its day changes", async () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const window = { dayOfWeek: 1, startTime: "07:00", endTime: "08:00" };
  render(<AddWindowDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} window={window} existing={[window]} />);
  fireEvent.click(screen.getByRole("button", { name: "Select Friday" }));
  expect(startValue()).toBe("07:00");
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ dayOfWeek: 5, startTime: "07:00", endTime: "08:00" }));
});

it("covers availability dialog event guards and selector no-ops", () => {
  const onOpenChange = vi.fn();
  const addView = render(<AddWindowDialog open={false} onOpenChange={onOpenChange} onSubmit={vi.fn()} />);
  addView.rerender(<AddWindowDialog open onOpenChange={onOpenChange} onSubmit={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Dialog open event" }));
  fireEvent.click(screen.getByRole("button", { name: "Dialog close event" }));
  fireEvent.click(screen.getByRole("button", { name: "Select empty" }));
  fireEvent.click(screen.getByRole("button", { name: "Select Tuesday" }));
  addView.rerender(<AddWindowDialog open={false} onOpenChange={onOpenChange} onSubmit={vi.fn()} />);
  expect(onOpenChange).toHaveBeenCalledWith(true);
  expect(onOpenChange).toHaveBeenCalledWith(false);

  cleanup();
  const dirtyClose = vi.fn();
  render(<AddWindowDialog open onOpenChange={dirtyClose} onSubmit={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Start"), { target: { value: "19:00" } });
  fireEvent.click(screen.getByRole("button", { name: "Dialog close event" }));
  fireEvent.click(screen.getByRole("button", { name: "Dialog close event" }));
  expect(dirtyClose).not.toHaveBeenCalledWith(false);

  cleanup();
  cancel.mockClear();
  const exception = vi.fn();
  const view = render(<ExceptionDialog open={false} onOpenChange={exception} onSubmit={vi.fn()} />);
  view.rerender(<ExceptionDialog open onOpenChange={exception} onSubmit={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Dialog open event" }));
  fireEvent.click(screen.getByRole("button", { name: "Dialog close event" }));
  view.rerender(<ExceptionDialog open={false} onOpenChange={exception} onSubmit={vi.fn()} />);
  expect(cancel).not.toHaveBeenCalled();
  view.rerender(<ExceptionDialog open onOpenChange={exception} onSubmit={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Reason (optional)"), { target: { value: "Trip" } });
  fireEvent.click(screen.getByRole("button", { name: "Dialog close event" }));
  fireEvent.click(screen.getByRole("button", { name: "Dialog close event" }));
  expect(exception).toHaveBeenCalledWith(false);
});
