import { afterEach, expect, it, vi } from "vitest";

const { apiJsonMock, apiVoidMock } = vi.hoisted(() => ({
  apiJsonMock: vi.fn(),
  apiVoidMock: vi.fn(),
}));

vi.mock("./client", () => ({
  apiJson: apiJsonMock,
  apiVoid: apiVoidMock,
  buildQuery: vi.fn(),
}));

import {
  checkGoogleLinkChallenge,
  completeRegistration,
  forgotPassword,
  getSession,
  linkGoogleAccount,
  login,
  logout,
  register,
  resendVerification,
  resetPassword,
  startGoogleAccountDeletion,
  startGoogleAccountLink,
  startGoogleSignIn,
  verifyEmail,
} from "./auth";

afterEach(() => {
  apiJsonMock.mockReset();
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

it("covers the remaining authentication request contracts", async () => {
  const signal = new AbortController().signal;
  apiJsonMock.mockResolvedValue({});
  apiVoidMock.mockResolvedValue(undefined);

  await register("student@example.com");
  await verifyEmail("verify-token");
  await completeRegistration({
    signupToken: "signup-token",
    name: "Student",
    password: "secure-password",
    timezone: "UTC",
  });
  await resendVerification("student@example.com");
  await login("student@example.com", "secure-password");
  await getSession(signal);
  await logout();
  await forgotPassword("student@example.com");
  await startGoogleSignIn("UTC");
  await startGoogleAccountLink("UTC");
  await startGoogleAccountDeletion("UTC");
  await linkGoogleAccount("secure-password");
  await checkGoogleLinkChallenge();

  expect(apiJsonMock).toHaveBeenNthCalledWith(1, "/auth/register", {
    method: "POST", body: { email: "student@example.com" }, csrf: false,
  });
  expect(apiJsonMock).toHaveBeenNthCalledWith(2, "/auth/verify-email", {
    method: "POST", body: { token: "verify-token" }, csrf: false,
  });
  expect(apiJsonMock).toHaveBeenNthCalledWith(3, "/auth/complete-registration", {
    method: "POST",
    body: {
      signup_token: "signup-token",
      name: "Student",
      password: "secure-password",
      timezone: "UTC",
    },
    csrf: false,
  });
  expect(apiJsonMock).toHaveBeenNthCalledWith(4, "/auth/resend-verification", {
    method: "POST", body: { email: "student@example.com" }, csrf: false,
  });
  expect(apiJsonMock).toHaveBeenNthCalledWith(5, "/auth/login", {
    method: "POST", body: { email: "student@example.com", password: "secure-password" }, csrf: false,
  });
  expect(apiJsonMock).toHaveBeenNthCalledWith(6, "/auth/session", { signal });
  expect(apiJsonMock).toHaveBeenNthCalledWith(7, "/auth/forgot-password", {
    method: "POST", body: { email: "student@example.com" }, csrf: false,
  });
  expect(apiJsonMock).toHaveBeenNthCalledWith(8, "/auth/google/start", {
    method: "POST", body: { timezone: "UTC" }, csrf: false,
  });
  expect(apiJsonMock).toHaveBeenNthCalledWith(9, "/auth/google/link/start", {
    method: "POST", body: { timezone: "UTC" },
  });
  expect(apiJsonMock).toHaveBeenNthCalledWith(10, "/auth/google/account-deletion/start", {
    method: "POST", body: { timezone: "UTC" },
  });
  expect(apiJsonMock).toHaveBeenNthCalledWith(11, "/auth/google/link/browser", {
    method: "POST", body: { password: "secure-password" }, csrf: false,
  });
  expect(apiVoidMock).toHaveBeenNthCalledWith(1, "/auth/logout", { method: "POST" });
  expect(apiVoidMock).toHaveBeenNthCalledWith(2, "/auth/google/link/browser");
});
