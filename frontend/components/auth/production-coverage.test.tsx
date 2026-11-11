// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ status: "loading", replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: state.replace }) }));
vi.mock("@/hooks/use-session", () => ({ useSession: () => ({ status: state.status }) }));

import { GuestOnly } from "./guest-only";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("GuestOnly", () => {
  it("shows the checking state until signed out", () => {
    state.status = "loading";
    const { rerender } = render(<GuestOnly><p>guest form</p></GuestOnly>);
    expect(screen.getByText("Checking your session…")).toBeTruthy();
    state.status = "unauthenticated";
    rerender(<GuestOnly><p>guest form</p></GuestOnly>);
    expect(screen.getByText("guest form")).toBeTruthy();
  });

  it("redirects authenticated visitors to the default and custom destinations", async () => {
    state.status = "authenticated";
    const { rerender } = render(<GuestOnly><p>guest form</p></GuestOnly>);
    await waitFor(() => expect(state.replace).toHaveBeenCalledWith("/dashboard"));
    rerender(<GuestOnly redirectTo="/settings"><p>guest form</p></GuestOnly>);
    await waitFor(() => expect(state.replace).toHaveBeenCalledWith("/settings"));
  });
});
