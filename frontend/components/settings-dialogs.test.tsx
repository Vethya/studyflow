// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { STUDYFLOW_SESSION_INVALIDATED_EVENT } from "@/lib/data-events";

const { changePasswordMock, setPasswordMock, successToastMock } = vi.hoisted(() => ({
  changePasswordMock: vi.fn(),
  setPasswordMock: vi.fn(),
  successToastMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  account: {
    changePassword: changePasswordMock,
    setPassword: setPasswordMock,
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: successToastMock,
    error: vi.fn(),
  },
}));

import { AddPasswordDialog, ChangePasswordDialog } from "./settings-dialogs";

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  setPasswordMock.mockResolvedValue(undefined);
  changePasswordMock.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setPasswordMock.mockReset();
  changePasswordMock.mockReset();
  successToastMock.mockReset();
});

it("invalidates the session and explains the add-password redirect", async () => {
  const onOpenChange = vi.fn();
  const onSessionInvalidated = vi.fn();
  window.addEventListener(STUDYFLOW_SESSION_INVALIDATED_EVENT, onSessionInvalidated);

  render(<AddPasswordDialog open onOpenChange={onOpenChange} onSaved={() => {}} />);
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: "new-secure-password" },
  });
  fireEvent.change(screen.getByLabelText("Repeat new password"), {
    target: { value: "new-secure-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add password" }));

  await waitFor(() => expect(setPasswordMock).toHaveBeenCalledWith("new-secure-password"));
  expect(successToastMock).toHaveBeenCalledWith("Password added. Please sign in again.");
  expect(onSessionInvalidated).toHaveBeenCalledOnce();
  expect(onOpenChange).toHaveBeenCalledWith(false);
  window.removeEventListener(STUDYFLOW_SESSION_INVALIDATED_EVENT, onSessionInvalidated);
});

it("invalidates the session and explains the change-password redirect", async () => {
  const onOpenChange = vi.fn();
  const onSessionInvalidated = vi.fn();
  window.addEventListener(STUDYFLOW_SESSION_INVALIDATED_EVENT, onSessionInvalidated);

  render(<ChangePasswordDialog open onOpenChange={onOpenChange} />);
  fireEvent.change(screen.getByLabelText("Current password"), {
    target: { value: "current-secure-password" },
  });
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: "new-secure-password" },
  });
  fireEvent.change(screen.getByLabelText("Repeat new password"), {
    target: { value: "new-secure-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));

  await waitFor(() =>
    expect(changePasswordMock).toHaveBeenCalledWith(
      "current-secure-password",
      "new-secure-password",
    ),
  );
  expect(successToastMock).toHaveBeenCalledWith("Password changed. Please sign in again.");
  expect(onSessionInvalidated).toHaveBeenCalledOnce();
  expect(onOpenChange).toHaveBeenCalledWith(false);
  window.removeEventListener(STUDYFLOW_SESSION_INVALIDATED_EVENT, onSessionInvalidated);
});
