// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ params: new URLSearchParams(), redirect: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => state.params,
  redirect: (path: string) => { state.redirect(path); throw new Error(`REDIRECT:${path}`); },
}));
vi.mock("next/font/google", () => ({
  Bricolage_Grotesque: () => ({ variable: "font-display" }),
  IBM_Plex_Mono: () => ({ variable: "font-data" }),
  Inter: () => ({ variable: "font-sans" }),
}));
vi.mock("@/components/ui/tooltip", () => ({ TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => <div data-testid="toaster" /> }));
vi.mock("@/hooks/use-session", () => ({ SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/theme-provider", () => ({ ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/swr-provider", () => ({ StudyFlowSWRProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

import AuthLayout from "./(auth)/layout";
import GoogleSignInLanding from "./app/page";
import GoogleImportErrorPage from "./(app)/import/google/page";
import PrivacyPage from "./privacy/page";
import RootLayout from "./layout";
import TermsPage from "./terms/page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("static and redirect pages", () => {
  it("renders auth, privacy, terms, and root layouts", () => {
    render(<AuthLayout><p>form</p></AuthLayout>);
    expect(screen.getByText("StudyFlow")).toBeTruthy();
    cleanup();
    render(<PrivacyPage />);
    expect(screen.getByRole("heading", { name: "Privacy Policy" })).toBeTruthy();
    cleanup();
    render(<TermsPage />);
    expect(screen.getByRole("heading", { name: "Terms of Service" })).toBeTruthy();
    cleanup();
    render(<RootLayout><p>child</p></RootLayout>);
    expect(screen.getByText("child")).toBeTruthy();
    expect(screen.getByTestId("toaster")).toBeTruthy();
  });

  it("redirects the Google landing page", () => {
    expect(() => GoogleSignInLanding()).toThrow("REDIRECT:/dashboard");
    expect(state.redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("renders every Google import error message and fallback", () => {
    for (const code of ["denied", "permission", "unavailable", "not-configured", "invalid", "unknown", ""]) {
      state.params = new URLSearchParams(`error=${code}`);
      render(<GoogleImportErrorPage />);
      expect(screen.getByRole("heading", { name: "Google import" })).toBeTruthy();
      cleanup();
    }
    state.params = { get: () => null } as unknown as URLSearchParams;
    render(<GoogleImportErrorPage />);
    expect(screen.getByText("The Google import could not be completed")).toBeTruthy();
  });
});
