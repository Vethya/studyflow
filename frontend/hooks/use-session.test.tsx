// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  notifyStudyFlowSessionInvalidated,
} from "@/lib/data-events";

const { getSessionMock } = vi.hoisted(() => ({ getSessionMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {},
  auth: {
    getSession: getSessionMock,
    logout: vi.fn(),
  },
}));

import { SessionProvider, useSession } from "./use-session";

function SessionProbe() {
  const { status, account } = useSession();
  return <output>{status}:{account?.email ?? "none"}</output>;
}

beforeEach(() => {
  getSessionMock.mockResolvedValue({
    account: { id: "account-1", email: "student@example.com", name: "Student" },
  });
});

afterEach(() => {
  cleanup();
  getSessionMock.mockReset();
});

it("marks the session unauthenticated when the server invalidates it", async () => {
  render(
    <SessionProvider>
      <SessionProbe />
    </SessionProvider>,
  );

  await waitFor(() => expect(screen.getByText("authenticated:student@example.com")).toBeTruthy());

  act(() => notifyStudyFlowSessionInvalidated());

  expect(screen.getByText("unauthenticated:none")).toBeTruthy();
});
