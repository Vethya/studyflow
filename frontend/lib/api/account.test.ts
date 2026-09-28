import { afterEach, expect, it, vi } from "vitest";

const { apiJsonMock, apiVoidMock } = vi.hoisted(() => ({
  apiJsonMock: vi.fn(),
  apiVoidMock: vi.fn(),
}));

vi.mock("./client", () => ({
  apiJson: apiJsonMock,
  apiVoid: apiVoidMock,
}));

import {
  changePassword,
  confirmDeletion,
  getDeletionStatus,
  getLinkedIdentities,
  getPreferences,
  getProfile,
  prepareDeletion,
  setPassword,
  updatePreferences,
  updateProfile,
} from "./account";

afterEach(() => {
  apiJsonMock.mockReset();
  apiVoidMock.mockReset();
});

it("adds a password without sending a current password", async () => {
  apiVoidMock.mockResolvedValue(undefined);

  await setPassword("new-secure-password");

  expect(apiVoidMock).toHaveBeenCalledWith("/account/password", {
    method: "PATCH",
    body: { new_password: "new-secure-password" },
  });
});

it("keeps the current-password contract for password changes", async () => {
  apiVoidMock.mockResolvedValue(undefined);

  await changePassword("current-secure-password", "new-secure-password");

  expect(apiVoidMock).toHaveBeenCalledWith("/account/password", {
    method: "PATCH",
    body: {
      current_password: "current-secure-password",
      new_password: "new-secure-password",
    },
  });
});

it("covers profile, preference, identity, and deletion request contracts", async () => {
  const signal = new AbortController().signal;

  await getProfile(signal);
  await updateProfile("New name");
  await getPreferences(signal);
  await updatePreferences(
    { timezone: "UTC", preferredSessionLength: 50, minimumBreak: 10 },
    signal,
  );
  await getLinkedIdentities(signal);
  await prepareDeletion("current-password");
  await getDeletionStatus(signal);
  await confirmDeletion();

  expect(apiJsonMock).toHaveBeenNthCalledWith(1, "/account/profile", { signal });
  expect(apiJsonMock).toHaveBeenNthCalledWith(2, "/account/profile", {
    method: "PATCH",
    body: { name: "New name" },
  });
  expect(apiJsonMock).toHaveBeenNthCalledWith(3, "/account/preferences", { signal });
  expect(apiJsonMock).toHaveBeenNthCalledWith(4, "/account/preferences", {
    method: "PATCH",
    body: {
      timezone: "UTC",
      preferred_session_length_minutes: 50,
      minimum_break_minutes: 10,
    },
    signal,
  });
  expect(apiJsonMock).toHaveBeenNthCalledWith(5, "/account/identities", { signal });
  expect(apiJsonMock).toHaveBeenNthCalledWith(6, "/account/deletion/status", { signal });
  expect(apiVoidMock).toHaveBeenNthCalledWith(1, "/account/deletion/prepare", {
    method: "POST",
    body: { current_password: "current-password" },
  });
  expect(apiVoidMock).toHaveBeenNthCalledWith(2, "/account/deletion/confirm", {
    method: "POST",
    body: { confirmation: "DELETE" },
  });
});
