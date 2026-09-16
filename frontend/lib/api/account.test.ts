import { afterEach, expect, it, vi } from "vitest";

const { apiJsonMock, apiVoidMock } = vi.hoisted(() => ({
  apiJsonMock: vi.fn(),
  apiVoidMock: vi.fn(),
}));

vi.mock("./client", () => ({
  apiJson: apiJsonMock,
  apiVoid: apiVoidMock,
}));

import { changePassword, setPassword } from "./account";

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
