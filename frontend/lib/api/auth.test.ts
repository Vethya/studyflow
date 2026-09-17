import { afterEach, expect, it, vi } from "vitest";

const { apiVoidMock } = vi.hoisted(() => ({ apiVoidMock: vi.fn() }));

vi.mock("./client", () => ({
  apiJson: vi.fn(),
  apiVoid: apiVoidMock,
  buildQuery: vi.fn(),
}));

import { resetPassword } from "./auth";

afterEach(() => {
  apiVoidMock.mockReset();
});

it("uses the no-content client for password resets", async () => {
  apiVoidMock.mockResolvedValue(undefined);

  await resetPassword("reset-token", "new-secure-password");

  expect(apiVoidMock).toHaveBeenCalledWith("/auth/reset-password", {
    method: "POST",
    body: { token: "reset-token", password: "new-secure-password" },
    csrf: false,
  });
});
