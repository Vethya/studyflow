// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";

const mocks = vi.hoisted(() => ({
  apiState: { data: null as any, isLoading: false, reload: vi.fn() },
  getSession: vi.fn(),
  logout: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("@/hooks/use-api", () => ({
  useApi: (_key: unknown, loader?: (signal: AbortSignal) => unknown) => {
    if (loader) void loader(new AbortController().signal);
    return mocks.apiState;
  },
}));

vi.mock("@/lib/api", () => {
  class MockApiError extends Error {
    isUnauthenticated: boolean;
    constructor(status: number, detail: string) {
      super(detail);
      this.isUnauthenticated = status === 401;
    }
  }
  return {
    ApiError: MockApiError,
    account: { getPreferences: vi.fn() },
    auth: { getSession: mocks.getSession, logout: mocks.logout },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

import { AccountTimezoneProvider, useAccountTimezone } from "./use-account-timezone";
import { useIsMobile } from "./use-mobile";
import { useNow } from "./use-now";
import { SessionProvider, useSession } from "./use-session";
import { ApiError } from "@/lib/api";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

function HookErrorProbe() {
  useSession();
  return null;
}

function TimezoneProbe() {
  return <output>{useAccountTimezone()}</output>;
}

function MobileProbe() {
  return <output>{useIsMobile() ? "mobile" : "desktop"}</output>;
}

function NowProbe({ interval }: { interval: number }) {
  const now = useNow(interval);
  return <output>{now.getTime()}</output>;
}

function SessionProbe() {
  const session = useSession();
  return (
    <div>
      <output>{session.status}:{session.account?.email ?? "none"}</output>
      <button onClick={() => void session.refresh()}>refresh</button>
      <button onClick={() => session.setAccount({ id: "2", email: "new@example.com", name: "New" })}>set</button>
      <button onClick={() => void session.signOut()}>sign out</button>
    </div>
  );
}

describe("small frontend hooks", () => {
  it("renders all account timezone states and lets the user retry", () => {
    mocks.apiState = { data: null, isLoading: true, reload: vi.fn() };
    const { rerender } = render(<AccountTimezoneProvider><TimezoneProbe /></AccountTimezoneProvider>);
    expect(screen.getByText("Loading account timezone…")).toBeTruthy();

    mocks.apiState = { data: null, isLoading: false, reload: vi.fn() };
    rerender(<AccountTimezoneProvider><TimezoneProbe /></AccountTimezoneProvider>);
    screen.getByRole("button", { name: "Try again" }).click();
    expect(mocks.apiState.reload).toHaveBeenCalled();

    mocks.apiState = { data: { timezone: "UTC" }, isLoading: false, reload: vi.fn() };
    rerender(<AccountTimezoneProvider><TimezoneProbe /></AccountTimezoneProvider>);
    expect(screen.getByText("UTC")).toBeTruthy();
  });

  it("tracks matchMedia changes and cleans up the subscription", () => {
    let listener: (() => void) | undefined;
    const mql = {
      matches: false,
      addEventListener: vi.fn((_event: string, callback: () => void) => { listener = callback; }),
      removeEventListener: vi.fn(),
    };
    window.matchMedia = vi.fn(() => mql as unknown as MediaQueryList);
    render(<MobileProbe />);
    expect(screen.getByText("desktop")).toBeTruthy();
    mql.matches = true;
    act(() => listener?.());
    expect(screen.getByText("mobile")).toBeTruthy();
    cleanup();
    expect(mql.removeEventListener).toHaveBeenCalled();
    expect(renderToString(<MobileProbe />)).toContain("desktop");
  });

  it("refreshes useNow on its interval and stops after unmount", () => {
    vi.useFakeTimers();
    const initial = 1_700_000_000_000;
    vi.setSystemTime(initial);
    const { unmount } = render(<NowProbe interval={1000} />);
    expect(screen.getByText(String(initial))).toBeTruthy();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText(String(initial + 1000))).toBeTruthy();
    unmount();
    vi.setSystemTime(initial + 2000);
    act(() => vi.advanceTimersByTime(1000));
  });
});

describe("useApi and useSession edge cases", () => {
  it("supports authenticated session actions and signed-out/error branches", async () => {
    mocks.getSession.mockResolvedValue({ account: { id: "1", email: "student@example.com", name: "Student", avatar_url: "avatar" } });
    mocks.logout.mockResolvedValue(undefined);
    render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><SessionProvider><SessionProbe /></SessionProvider></SWRConfig>);
    await waitFor(() => expect(screen.getByText("authenticated:student@example.com")).toBeTruthy());
    act(() => screen.getByRole("button", { name: "set" }).click());
    await waitFor(() => expect(screen.getByText("authenticated:new@example.com")).toBeTruthy());
    await act(async () => { screen.getByRole("button", { name: "refresh" }).click(); });
    await act(async () => { screen.getByRole("button", { name: "sign out" }).click(); });
    expect(mocks.replace).toHaveBeenCalledWith("/login");
    cleanup();

    mocks.getSession.mockRejectedValueOnce(new ApiError(401, "expired"));
    render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><SessionProvider><SessionProbe /></SessionProvider></SWRConfig>);
    await waitFor(() => expect(screen.getByText("unauthenticated:none")).toBeTruthy());
    cleanup();

    mocks.getSession.mockRejectedValueOnce(new Error("server down"));
    render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><SessionProvider><SessionProbe /></SessionProvider></SWRConfig>);
    await waitFor(() => expect(screen.getByText("unauthenticated:none")).toBeTruthy());
  });

  it("rejects useSession outside its provider", () => {
    expect(() => render(<HookErrorProbe />)).toThrow("useSession must be used inside");
  });
});
