// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  status: "loading" as string,
  pathname: "/dashboard",
  replace: vi.fn(),
  registration: null as any,
}));

vi.mock("next/navigation", () => ({ usePathname: () => state.pathname, useRouter: () => ({ replace: state.replace }) }));
vi.mock("@/hooks/use-session", () => ({ useSession: () => ({ status: state.status }) }));
vi.mock("@/hooks/use-account-timezone", () => ({ AccountTimezoneProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/hooks/use-warm-cache", () => ({ useWarmCache: vi.fn() }));
vi.mock("@/lib/webmcp/register", () => ({ startStudyFlowWebMcp: () => state.registration }));
// Layout tests isolate the shell; its real navigation is exercised by the browser smoke checks.
vi.mock("@/components/shadcn-space/blocks/dashboard-shell-01/app-sidebar", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div><aside>sidebar</aside><div>topbar</div>{children}</div>,
}));

import { consumeAccountDeleted, markAccountDeleted } from "@/lib/user-storage";
import AppLayout from "./(app)/layout";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.registration = null;
  consumeAccountDeleted();
});

describe("authenticated app layout", () => {
  it("guards loading and unauthenticated sessions", async () => {
    state.status = "loading";
    const { rerender } = render(<AppLayout><p>page</p></AppLayout>);
    expect(screen.getByText("Checking your session…")).toBeTruthy();
    state.status = "unauthenticated";
    rerender(<AppLayout><p>page</p></AppLayout>);
    await waitFor(() => expect(state.replace).toHaveBeenCalledWith("/login?next=%2Fdashboard"));
    expect(screen.getByText("Checking your session…")).toBeTruthy();
  });

  it("sends a deleted account to a confirmation instead of back to settings", async () => {
    state.status = "unauthenticated";
    state.pathname = "/settings";
    markAccountDeleted();
    render(
      <AppLayout>
        <p>page</p>
      </AppLayout>,
    );
    await waitFor(() => expect(state.replace).toHaveBeenCalledWith("/login?deleted=1"));
  });

  it("renders the shell and disposes WebMCP registration", async () => {
    const dispose = vi.fn();
    state.status = "authenticated";
    state.registration = { ready: Promise.resolve(), dispose };
    render(<AppLayout><p>page</p></AppLayout>);
    expect(screen.getByText("sidebar")).toBeTruthy();
    expect(screen.getByText("topbar")).toBeTruthy();
    expect(screen.getByText("page")).toBeTruthy();
    expect(dispose).not.toHaveBeenCalled();
    cleanup();
    expect(dispose).toHaveBeenCalled();
  });

  it("cleans up a failed registration and handles no model context", async () => {
    const dispose = vi.fn();
    state.status = "authenticated";
    state.registration = { ready: Promise.reject(new Error("register failed")), dispose };
    render(<AppLayout><p>page</p></AppLayout>);
    await waitFor(() => expect(dispose).toHaveBeenCalled());
    cleanup();
    state.registration = null;
    render(<AppLayout><p>page</p></AppLayout>);
    expect(screen.getByText("page")).toBeTruthy();
  });
});
