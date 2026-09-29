// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { STUDYFLOW_SESSION_INVALIDATED_EVENT } from "@/lib/data-events";

const { changePasswordMock, setPasswordMock, successToastMock, errorToastMock, updatePreferencesMock, updateProfileMock, prepareDeletionMock, confirmDeletionMock } = vi.hoisted(() => ({
  changePasswordMock: vi.fn(),
  setPasswordMock: vi.fn(),
  updatePreferencesMock: vi.fn(),
  updateProfileMock: vi.fn(),
  prepareDeletionMock: vi.fn(),
  confirmDeletionMock: vi.fn(),
  successToastMock: vi.fn(),
  errorToastMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  ApiError: class MockApiError extends Error { status: number; constructor(status: number) { super("api error"); this.status = status; } },
  account: {
    changePassword: changePasswordMock,
    setPassword: setPasswordMock,
    updatePreferences: updatePreferencesMock,
    updateProfile: updateProfileMock,
    prepareDeletion: prepareDeletionMock,
    confirmDeletion: confirmDeletionMock,
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: successToastMock,
    error: errorToastMock,
  },
}));

import { AddPasswordDialog, AccountDeletionDialog, ChangeNameDialog, ChangePasswordDialog, ChangeTimezoneDialog } from "./settings-dialogs";
import { ApiError } from "@/lib/api";

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  setPasswordMock.mockResolvedValue(undefined);
  changePasswordMock.mockResolvedValue(undefined);
  updatePreferencesMock.mockResolvedValue({ timezone: "Asia/Tokyo", preferred_session_length_minutes: 60, minimum_break_minutes: 10, availability_confirmation_required: false });
  updateProfileMock.mockResolvedValue({ name: "New Name", email: "student@example.com", password_set: false });
  prepareDeletionMock.mockResolvedValue(undefined);
  confirmDeletionMock.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setPasswordMock.mockReset();
  changePasswordMock.mockReset();
  successToastMock.mockReset();
  errorToastMock.mockReset();
  updatePreferencesMock.mockReset();
  updateProfileMock.mockReset();
  prepareDeletionMock.mockReset();
  confirmDeletionMock.mockReset();
});

it("invalidates the session and explains the add-password redirect", async () => {
  const onOpenChange = vi.fn();
  const onSessionInvalidated = vi.fn();
  window.addEventListener(STUDYFLOW_SESSION_INVALIDATED_EVENT, onSessionInvalidated);

  render(<AddPasswordDialog open onOpenChange={onOpenChange} />);
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

it("covers password validation, discard, and API errors", async () => {
  setPasswordMock.mockRejectedValueOnce(new Error("password rejected"));
  const onOpenChange = vi.fn();
  render(<AddPasswordDialog open onOpenChange={onOpenChange} />);
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "short" } });
  expect(screen.getByText(/more characters needed/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Repeat new password"), { target: { value: "different" } });
  expect(screen.getByText("These do not match.")).toBeTruthy();
  fireEvent.submit(document.querySelector("form")!);
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "12345678901" } });
  fireEvent.change(screen.getByLabelText("Repeat new password"), { target: { value: "12345678901" } });
  expect(screen.getByText("1 more character needed.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "long-enough-password" } });
  fireEvent.change(screen.getByLabelText("Repeat new password"), { target: { value: "long-enough-password" } });
  screen.getByRole("button", { name: "Cancel" }).click();
  await waitFor(() => expect(screen.getByRole("button", { name: "Discard changes" })).toBeTruthy());
  screen.getByRole("button", { name: "Discard changes" }).click();
  expect(onOpenChange).toHaveBeenCalledWith(false);

  cleanup();
  render(<AddPasswordDialog open onOpenChange={onOpenChange} />);
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "long-enough-password" } });
  fireEvent.change(screen.getByLabelText("Repeat new password"), { target: { value: "long-enough-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Add password" }));
  await waitFor(() => expect(screen.getByText("password rejected")).toBeTruthy());

  cleanup();
  changePasswordMock.mockRejectedValueOnce(new Error("change rejected"));
  render(<ChangePasswordDialog open onOpenChange={onOpenChange} />);
  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "current" } });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "long-enough-password" } });
  fireEvent.change(screen.getByLabelText("Repeat new password"), { target: { value: "long-enough-password" } });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "short" } });
  expect(screen.getByText(/more characters needed/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "12345678901" } });
  expect(screen.getByText("1 more character needed.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Repeat new password"), { target: { value: "different" } });
  expect(screen.getByText("These do not match.")).toBeTruthy();
  fireEvent.submit(document.querySelector("form")!);
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "long-enough-password" } });
  fireEvent.change(screen.getByLabelText("Repeat new password"), { target: { value: "long-enough-password" } });
  screen.getByRole("button", { name: "Change password" }).click();
  await waitFor(() => expect(screen.getByText("change rejected")).toBeTruthy());
});

it("covers timezone and name saves plus account deletion paths", async () => {
  const preferences = { timezone: "UTC", preferred_session_length_minutes: 60, minimum_break_minutes: 10, availability_confirmation_required: false };
  const onSaved = vi.fn();
  render(<ChangeTimezoneDialog open onOpenChange={vi.fn()} preferences={preferences} onSaved={onSaved} />);
  fireEvent.submit(document.querySelector("form")!);
  const timezoneTrigger = screen.getByRole("combobox");
  fireEvent.mouseDown(timezoneTrigger);
  fireEvent.keyDown(timezoneTrigger, { key: "ArrowDown" });
  await waitFor(() => expect(screen.getByText(/Tokyo/)).toBeTruthy());
  screen.getByText(/Tokyo/).click();
  await waitFor(() => expect(screen.getByRole("button", { name: "Save timezone" })).toBeTruthy());
  screen.getByRole("button", { name: "Save timezone" }).click();
  await waitFor(() => expect(updatePreferencesMock).toHaveBeenCalled());
  expect(onSaved).toHaveBeenCalled();
  cleanup();

  const nameSaved = vi.fn();
  const cleanNameView = render(<ChangeNameDialog open onOpenChange={vi.fn()} currentName="Student" onSaved={nameSaved} />);
  fireEvent.submit(document.querySelector("form")!);
  screen.getByRole("button", { name: "Cancel" }).click();
  cleanNameView.rerender(<ChangeNameDialog open={false} onOpenChange={vi.fn()} currentName="Student" onSaved={nameSaved} />);
  cleanup();
  render(<ChangeNameDialog open onOpenChange={vi.fn()} currentName="Student" onSaved={nameSaved} />);
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New Name" } });
  screen.getByRole("button", { name: "Save name" }).click();
  await waitFor(() => expect(updateProfileMock).toHaveBeenCalledWith("New Name"));
  expect(nameSaved).toHaveBeenCalled();
  cleanup();

  const onDeleted = vi.fn();
  const startGoogle = vi.fn().mockResolvedValue(undefined);
  render(<AccountDeletionDialog open onOpenChange={vi.fn()} passwordSet={null} googleReady={false} onStartGoogle={startGoogle} onGoogleChallengeExpired={vi.fn()} onDeleted={onDeleted} />);
  expect(screen.getByText("Loading your account details before deletion.")).toBeTruthy();
  cleanup();
  render(<AccountDeletionDialog open onOpenChange={vi.fn()} passwordSet={false} googleReady={false} onStartGoogle={startGoogle} onGoogleChallengeExpired={vi.fn()} onDeleted={onDeleted} />);
  fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
  fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), { target: { value: "DELETE" } });
  screen.getByRole("button", { name: "Continue with Google" }).click();
  await waitFor(() => expect(startGoogle).toHaveBeenCalled());
  cleanup();
  const expired = vi.fn();
  confirmDeletionMock.mockRejectedValueOnce(new ApiError(400, "bad request"));
  render(<AccountDeletionDialog open onOpenChange={vi.fn()} passwordSet={false} googleReady onStartGoogle={startGoogle} onGoogleChallengeExpired={expired} onDeleted={onDeleted} />);
  fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), { target: { value: "DELETE" } });
  screen.getByRole("button", { name: "Delete account" }).click();
  await waitFor(() => expect(expired).toHaveBeenCalled());
  cleanup();
  render(<AccountDeletionDialog open onOpenChange={vi.fn()} passwordSet onStartGoogle={startGoogle} googleReady={false} onGoogleChallengeExpired={vi.fn()} onDeleted={onDeleted} />);
  fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), { target: { value: "DELETE" } });
  fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "current" } });
  fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), { target: { value: "DELETE" } });
  screen.getByRole("button", { name: "Delete account" }).click();
  await waitFor(() => expect(onDeleted).toHaveBeenCalled());
});

it("covers clean closes and repeated close requests while discarding", async () => {
  const addClosed = vi.fn();
  render(<AddPasswordDialog open onOpenChange={addClosed} />);
  screen.getByRole("button", { name: "Cancel" }).click();
  expect(addClosed).toHaveBeenCalledWith(false);

  cleanup();
  const addDirtyClosed = vi.fn();
  render(<AddPasswordDialog open onOpenChange={addDirtyClosed} />);
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "long-enough-password" } });
  screen.getByRole("button", { name: "Cancel" }).click();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(addDirtyClosed).not.toHaveBeenCalled();

  cleanup();
  const changeClosed = vi.fn();
  render(<ChangePasswordDialog open onOpenChange={changeClosed} />);
  screen.getByRole("button", { name: "Cancel" }).click();
  expect(changeClosed).toHaveBeenCalledWith(false);

  cleanup();
  const changeDirtyClosed = vi.fn();
  render(<ChangePasswordDialog open onOpenChange={changeDirtyClosed} />);
  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "current" } });
  screen.getByRole("button", { name: "Cancel" }).click();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(changeDirtyClosed).not.toHaveBeenCalled();
});

it("covers cancelled and failed profile/timezone/deletion flows", async () => {
  const preferences = { timezone: "UTC", preferred_session_length_minutes: 60, minimum_break_minutes: 10, availability_confirmation_required: false };
  const onOpenChange = vi.fn();
  render(<ChangeTimezoneDialog open onOpenChange={onOpenChange} preferences={null} onSaved={vi.fn()} />);
  fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
  screen.getByRole("button", { name: "Cancel" }).click();
  expect(onOpenChange).toHaveBeenCalledWith(false);
  cleanup();

  updatePreferencesMock.mockRejectedValueOnce(new Error("timezone failed"));
  render(<ChangeTimezoneDialog open onOpenChange={onOpenChange} preferences={preferences} onSaved={vi.fn()} />);
  fireEvent.mouseDown(screen.getByRole("combobox"));
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
  await waitFor(() => expect(screen.getByText(/Tokyo/)).toBeTruthy());
  screen.getByText(/Tokyo/).click();
  await waitFor(() => expect(screen.getByText(/Your deadlines do not move/)).toBeTruthy());
  screen.getByRole("button", { name: "Save timezone" }).click();
  await waitFor(() => expect(errorToastMock).toHaveBeenCalledWith("timezone failed"));
  cleanup();

  updateProfileMock.mockRejectedValueOnce(new Error("name failed"));
  render(<ChangeNameDialog open onOpenChange={onOpenChange} currentName="Student" onSaved={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: " New Name " } });
  screen.getByRole("button", { name: "Save name" }).click();
  await waitFor(() => expect(errorToastMock).toHaveBeenCalledWith("name failed"));
  cleanup();

  const startGoogle = vi.fn().mockRejectedValueOnce(new Error("google failed"));
  const deletionView = render(<AccountDeletionDialog open onOpenChange={onOpenChange} passwordSet={false} googleReady={false} onStartGoogle={startGoogle} onGoogleChallengeExpired={vi.fn()} onDeleted={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), { target: { value: "DELETE" } });
  screen.getByRole("button", { name: "Continue with Google" }).click();
  await waitFor(() => expect(screen.getByText("google failed")).toBeTruthy());
  screen.getByRole("button", { name: "Cancel" }).click();
  expect(onOpenChange).toHaveBeenCalledWith(false);
  deletionView.rerender(<AccountDeletionDialog open={false} onOpenChange={onOpenChange} passwordSet={false} googleReady={false} onStartGoogle={startGoogle} onGoogleChallengeExpired={vi.fn()} onDeleted={vi.fn()} />);
  cleanup();

  prepareDeletionMock.mockRejectedValueOnce(new Error("password failed"));
  render(<AccountDeletionDialog open onOpenChange={onOpenChange} passwordSet googleReady={false} onStartGoogle={vi.fn()} onGoogleChallengeExpired={vi.fn()} onDeleted={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "current" } });
  fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), { target: { value: "DELETE" } });
  screen.getByRole("button", { name: "Delete account" }).click();
  await waitFor(() => expect(screen.getByText("password failed")).toBeTruthy());
});
