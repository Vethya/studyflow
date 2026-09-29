// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const {
  loginMock,
  googleMock,
  refreshMock,
  replaceMock,
  searchParamsMock,
} = vi.hoisted(() => ({
  loginMock: vi.fn(),
  googleMock: vi.fn(),
  refreshMock: vi.fn(),
  replaceMock: vi.fn(),
  searchParamsMock: {
    get: vi.fn(),
    has: vi.fn(),
  },
}));
const ApiErrorMock = vi.hoisted(() => class extends Error {
  isRateLimited = false;
  retryAfterSeconds?: number;
});

vi.mock("@/lib/api", () => {
  return {
    ApiError: ApiErrorMock,
    auth: {
      login: loginMock,
      startGoogleSignIn: googleMock,
    },
  };
});

vi.mock("@/hooks/use-api", () => ({
  describeError: () => "Invalid email or password",
}));

vi.mock("@/hooks/use-session", () => ({
  useSession: () => ({ refresh: refreshMock }),
}));

vi.mock("@/components/auth/guest-only", () => ({
  GuestOnly: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => searchParamsMock,
}));

vi.mock("@/lib/timezones", () => ({ detectTimezone: () => "UTC" }));

import LoginPage from "./page";

afterEach(() => {
  cleanup();
  loginMock.mockReset();
  googleMock.mockReset();
  refreshMock.mockReset();
  replaceMock.mockReset();
  searchParamsMock.get.mockReset();
  searchParamsMock.has.mockReset();
});

it("logs in, refreshes the session, and returns to a safe requested page", async () => {
  loginMock.mockResolvedValue(undefined);
  refreshMock.mockResolvedValue(undefined);
  searchParamsMock.get.mockReturnValue("/calendar?view=week");
  searchParamsMock.has.mockReturnValue(false);

  render(<LoginPage />);
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "student@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "correct-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

  await waitFor(() => expect(loginMock).toHaveBeenCalledWith("student@example.com", "correct-password"));
  expect(refreshMock).toHaveBeenCalledOnce();
  expect(replaceMock).toHaveBeenCalledWith("/calendar?view=week");
});

it("shows a login error and does not redirect when authentication fails", async () => {
  loginMock.mockRejectedValue(new Error("bad credentials"));
  searchParamsMock.get.mockReturnValue(null);
  searchParamsMock.has.mockReturnValue(false);

  render(<LoginPage />);
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "student@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "wrong-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

  expect(await screen.findByText("Invalid email or password")).toBeTruthy();
  expect(refreshMock).not.toHaveBeenCalled();
  expect(replaceMock).not.toHaveBeenCalled();
});

it("shows the registration confirmation message", () => {
  searchParamsMock.get.mockReturnValue(null);
  searchParamsMock.has.mockImplementation((name: string) => name === "registered");

  render(<LoginPage />);

  expect(screen.getByText(/account is ready/i)).toBeTruthy();
});

it("covers reset messaging, unsafe next paths, rate limits, and Google errors", async () => {
  searchParamsMock.get.mockReturnValue("//evil.example");
  searchParamsMock.has.mockImplementation((name: string) => name === "reset");
  render(<LoginPage />);
  expect(screen.getByText(/password has been reset/i)).toBeTruthy();
  loginMock.mockRejectedValueOnce(Object.assign(new ApiErrorMock(), { isRateLimited: true, retryAfterSeconds: 61 }));
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "student@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
  expect(await screen.findByText(/Try again in 2 minutes/)).toBeTruthy();
  cleanup();

  searchParamsMock.get.mockReturnValue("/login");
  searchParamsMock.has.mockReturnValue(false);
  loginMock.mockRejectedValueOnce(Object.assign(new ApiErrorMock(), { isRateLimited: true }));
  render(<LoginPage />);
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "student@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
  expect(await screen.findByText(/Try again later/)).toBeTruthy();

  googleMock.mockRejectedValueOnce(new Error("google unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
  expect(await screen.findByText("Invalid email or password")).toBeTruthy();

  cleanup();
  searchParamsMock.get.mockReturnValue("/%zz");
  searchParamsMock.has.mockReturnValue(false);
  googleMock.mockResolvedValueOnce({ authorization_url: "/oauth" });
  render(<LoginPage />);
  fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
  await waitFor(() => expect(googleMock).toHaveBeenCalledWith("UTC"));
});

it("falls back when the requested path cannot be parsed", () => {
  const NativeURL = globalThis.URL;
  vi.stubGlobal("URL", class { constructor() { throw new Error("invalid URL"); } } as unknown as typeof URL);
  searchParamsMock.get.mockReturnValue("/calendar");
  searchParamsMock.has.mockReturnValue(false);
  render(<LoginPage />);
  expect(screen.getByRole("heading", { name: "Welcome back" })).toBeTruthy();
  vi.stubGlobal("URL", NativeURL);
});
