// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const {
  loginMock,
  refreshMock,
  replaceMock,
  searchParamsMock,
} = vi.hoisted(() => ({
  loginMock: vi.fn(),
  refreshMock: vi.fn(),
  replaceMock: vi.fn(),
  searchParamsMock: {
    get: vi.fn(),
    has: vi.fn(),
  },
}));

vi.mock("@/lib/api", () => {
  class MockApiError extends Error {
    isRateLimited = false;
    retryAfterSeconds?: number;
  }

  return {
    ApiError: MockApiError,
    auth: {
      login: loginMock,
      startGoogleSignIn: vi.fn(),
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
