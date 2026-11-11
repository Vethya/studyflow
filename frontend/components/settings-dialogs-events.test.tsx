// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ setPassword: vi.fn(), changePassword: vi.fn() }));
const cancel = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error { status = 400; },
  account: { setPassword: api.setPassword, changePassword: api.changePassword },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/data-events", () => ({ notifyStudyFlowSessionInvalidated: vi.fn() }));
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

import { AddPasswordDialog, ChangePasswordDialog } from "./settings-dialogs";

afterEach(() => cleanup());

it("covers password dialog root open/close events and discard confirmation", () => {
  const addChanged = vi.fn();
  const addView = render(<AddPasswordDialog open onOpenChange={addChanged} />);
  fireEvent.click(screen.getByRole("button", { name: "Open event" }));
  fireEvent.click(screen.getByRole("button", { name: "Close event" }));
  expect(addChanged).toHaveBeenNthCalledWith(1, true);
  expect(addChanged).toHaveBeenNthCalledWith(2, false);
  addView.rerender(<AddPasswordDialog open={false} onOpenChange={addChanged} />);

  cleanup();
  cancel.mockClear();
  const dirtyAddChanged = vi.fn();
  render(<AddPasswordDialog open onOpenChange={dirtyAddChanged} />);
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "long-enough-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Close event" }));
  expect(cancel).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Close event" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(dirtyAddChanged).toHaveBeenCalledWith(false);

  cleanup();
  const changeChanged = vi.fn();
  const changeView = render(<ChangePasswordDialog open onOpenChange={changeChanged} />);
  fireEvent.click(screen.getByRole("button", { name: "Open event" }));
  fireEvent.click(screen.getByRole("button", { name: "Close event" }));
  expect(changeChanged).toHaveBeenNthCalledWith(1, true);
  expect(changeChanged).toHaveBeenNthCalledWith(2, false);
  changeView.rerender(<ChangePasswordDialog open={false} onOpenChange={changeChanged} />);

  cleanup();
  cancel.mockClear();
  const dirtyChangeChanged = vi.fn();
  render(<ChangePasswordDialog open onOpenChange={dirtyChangeChanged} />);
  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "current" } });
  fireEvent.click(screen.getByRole("button", { name: "Close event" }));
  expect(cancel).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Close event" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(dirtyChangeChanged).toHaveBeenCalledWith(false);
});

it("covers password validation, success, errors, and saving guards", async () => {
  api.setPassword.mockReset();
  api.changePassword.mockReset();
  api.setPassword.mockResolvedValueOnce(undefined);
  const addChanged = vi.fn();
  render(<AddPasswordDialog open onOpenChange={addChanged} />);
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "short" } });
  expect(screen.getByText(/7 more characters/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Repeat new password"), { target: { value: "different" } });
  expect(screen.getByText("These do not match.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "long-enough-password" } });
  fireEvent.change(screen.getByLabelText("Repeat new password"), { target: { value: "long-enough-password" } });
  fireEvent.submit(document.querySelector("form")!);
  await waitFor(() => expect(addChanged).toHaveBeenCalledWith(false));

  cleanup();
  api.setPassword.mockRejectedValueOnce(new Error("set failed"));
  render(<AddPasswordDialog open onOpenChange={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "long-enough-password" } });
  fireEvent.change(screen.getByLabelText("Repeat new password"), { target: { value: "long-enough-password" } });
  fireEvent.submit(document.querySelector("form")!);
  await waitFor(() => expect(screen.getByText("set failed")).toBeTruthy());

  cleanup();
  api.changePassword.mockResolvedValueOnce(undefined);
  const changeChanged = vi.fn();
  render(<ChangePasswordDialog open onOpenChange={changeChanged} />);
  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "current" } });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "long-enough-password" } });
  fireEvent.change(screen.getByLabelText("Repeat new password"), { target: { value: "long-enough-password" } });
  fireEvent.submit(document.querySelector("form")!);
  await waitFor(() => expect(changeChanged).toHaveBeenCalledWith(false));

  cleanup();
  api.changePassword.mockRejectedValueOnce(new Error("change failed"));
  render(<ChangePasswordDialog open onOpenChange={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "current" } });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "long-enough-password" } });
  fireEvent.change(screen.getByLabelText("Repeat new password"), { target: { value: "long-enough-password" } });
  fireEvent.submit(document.querySelector("form")!);
  await waitFor(() => expect(screen.getByText("change failed")).toBeTruthy());
});
