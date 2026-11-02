// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  notifyStudyFlowSessionInvalidated,
} from "@/lib/data-events";

const { getSessionMock, logoutMock, undoMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  logoutMock: vi.fn(),
  undoMock: { flushPendingActions: vi.fn(), cancelPendingActions: vi.fn() },
}));
vi.mock("@/lib/undo", () => undoMock);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {},
  auth: {
    getSession: getSessionMock,
    logout: logoutMock,
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

it("sends pending undo actions before signing out, and drops them when the session ends", async () => {
  const order: string[] = [];
  undoMock.flushPendingActions.mockImplementation(async () => { order.push("flush"); });
  logoutMock.mockImplementation(async () => { order.push("logout"); });
  function SignOutProbe() {
    const { signOut } = useSession();
    return <button onClick={() => void signOut()}>Sign out</button>;
  }
  render(
    <SessionProvider>
      <SignOutProbe />
    </SessionProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await waitFor(() => expect(order).toEqual(["flush", "logout"]));
  // Flushed while this account is still signed in, so the next one never gets them.
  expect(order).toEqual(["flush", "logout"]);
  expect(undoMock.cancelPendingActions).toHaveBeenCalled();
});
