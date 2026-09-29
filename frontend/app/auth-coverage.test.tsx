// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  params: new URLSearchParams(),
  router: { push: vi.fn(), replace: vi.fn() },
  session: { status: "unauthenticated" as string, refresh: vi.fn(), signOut: vi.fn() },
  auth: {
    forgotPassword: vi.fn(), register: vi.fn(), startGoogleSignIn: vi.fn(),
    resetPassword: vi.fn(), checkGoogleLinkChallenge: vi.fn(), linkGoogleAccount: vi.fn(),
    resendVerification: vi.fn(), verifyEmail: vi.fn(), completeRegistration: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => state.router,
  useSearchParams: () => state.params,
}));

vi.mock("@/components/auth/guest-only", () => ({
  GuestOnly: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/use-session", () => ({ useSession: () => state.session }));

vi.mock("@/components/ui/select", () => {
  const SelectContext = React.createContext<{ onValueChange?: (value: string) => void }>({});
  return {
    Select: ({ onValueChange, children }: any) => <SelectContext.Provider value={{ onValueChange }}><div><button type="button" onClick={() => onValueChange?.("")}>Invoke empty timezone</button>{children}</div></SelectContext.Provider>,
    SelectTrigger: ({ children, ...props }: any) => <button type="button" role="combobox" {...props}>{children}</button>,
    SelectValue: ({ children }: any) => <span>{typeof children === "function" ? children("") : children}</span>,
    SelectContent: ({ children }: any) => <div>{children}</div>,
    SelectGroup: ({ children }: any) => <div>{children}</div>,
    SelectLabel: ({ children }: any) => <span>{children}</span>,
    SelectItem: ({ value, children }: any) => { const context = React.useContext(SelectContext); return <button type="button" role="option" onClick={() => context.onValueChange?.(value)}>{children}</button>; },
  };
});

vi.mock("@/hooks/use-api", () => ({
  describeError: (error: unknown) => error instanceof Error ? error.message : "Unexpected failure",
}));

vi.mock("@/lib/data-events", () => ({ notifyStudyFlowSessionInvalidated: vi.fn() }));

vi.mock("@/lib/api", () => {
  class MockApiError extends Error {
    status: number;
    detail: string;
    fieldErrors: Record<string, string>;
    constructor(status: number, detail = "API error", fieldErrors: Record<string, string> = {}) {
      super(detail);
      this.status = status;
      this.detail = detail;
      this.fieldErrors = fieldErrors;
    }
    get isRateLimited() { return this.status === 429; }
    get isValidation() { return this.status === 422; }
    get isUnauthenticated() { return this.status === 401; }
  }
  return { ApiError: MockApiError, auth: state.auth };
});

import { ApiError, auth } from "@/lib/api";
import ForgotPasswordPage from "./(auth)/forgot-password/page";
import GoogleLinkPage from "./(auth)/login/google-link/page";
import GoogleErrorPage from "./(auth)/login/google-error/[reason]/page";
import RegisterPage from "./(auth)/register/page";
import ResetPasswordPage from "./(auth)/reset-password/page";
import VerifyEmailPage from "./(auth)/verify-email/page";

function form(): HTMLFormElement {
  const element = document.querySelector("form");
  if (!element) throw new Error("Expected a form");
  return element;
}

beforeEach(() => {
  state.params = new URLSearchParams();
  state.session.status = "unauthenticated";
  vi.clearAllMocks();
  state.auth.checkGoogleLinkChallenge.mockResolvedValue(undefined);
  state.auth.verifyEmail.mockResolvedValue({ signup_token: "signup-1" });
});

afterEach(cleanup);

describe("auth entry points", () => {
  it("handles forgot-password success, rate limiting, generic errors, and reset", async () => {
    state.auth.forgotPassword.mockResolvedValue(undefined);
    render(<ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "student@example.com" } });
    fireEvent.submit(form());
    await waitFor(() => expect(screen.getByText("Check your inbox")).toBeTruthy());
    screen.getByRole("button", { name: "Send another link" }).click();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Set or reset password" })).toBeTruthy());
    state.auth.forgotPassword.mockRejectedValueOnce(new ApiError(429));
    fireEvent.submit(form());
    await waitFor(() => expect(screen.getByText(/Too many reset requests/)).toBeTruthy());
    state.auth.forgotPassword.mockRejectedValueOnce(new Error("mail down"));
    fireEvent.submit(form());
    await waitFor(() => expect(screen.getByText("mail down")).toBeTruthy());
  });

  it("validates registration, handles API branches, and shows the sent state", async () => {
    state.auth.register.mockResolvedValue(undefined);
    render(<RegisterPage />);
    const email = screen.getByLabelText("Email");
    fireEvent.submit(form());
    expect(screen.getByText("Enter your email address.")).toBeTruthy();
    fireEvent.change(email, { target: { value: "bad" } });
    fireEvent.submit(form());
    await waitFor(() => expect(screen.getByText(/Enter a valid email address/)).toBeTruthy());
    fireEvent.change(email, { target: { value: "student@example.com" } });
    state.auth.register.mockRejectedValueOnce(new ApiError(429));
    fireEvent.submit(form());
    await waitFor(() => expect(screen.getByText(/Too many registration attempts/)).toBeTruthy());
    state.auth.register.mockRejectedValueOnce(new ApiError(422, "invalid", { email: "Email is invalid" }));
    fireEvent.submit(form());
    await waitFor(() => expect(screen.getByText("Email is invalid")).toBeTruthy());
    state.auth.register.mockRejectedValueOnce(new ApiError(422));
    fireEvent.submit(form());
    await waitFor(() => expect(screen.getByText("Enter a valid email address.")).toBeTruthy());
    state.auth.register.mockRejectedValueOnce(new Error("registration down"));
    fireEvent.submit(form());
    await waitFor(() => expect(screen.getByText("registration down")).toBeTruthy());
    state.auth.startGoogleSignIn.mockRejectedValueOnce(new Error("google registration down"));
    screen.getByRole("button", { name: "Continue with Google" }).click();
    await waitFor(() => expect(screen.getByText("google registration down")).toBeTruthy());
    state.auth.startGoogleSignIn.mockResolvedValueOnce({ authorization_url: "/google" });
    screen.getByRole("button", { name: "Continue with Google" }).click();
    await waitFor(() => expect(state.auth.startGoogleSignIn).toHaveBeenCalled());
    state.auth.register.mockResolvedValueOnce(undefined);
    fireEvent.submit(form());
    await waitFor(() => expect(screen.getByText("Check your inbox")).toBeTruthy());
    screen.getByRole("button", { name: "Use a different email" }).click();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Create your account" })).toBeTruthy());
  });

  it("covers reset-password token, mismatch, error, success, and redirect states", async () => {
    state.params = new URLSearchParams();
    state.session.status = "loading";
    render(<ResetPasswordPage />);
    expect(document.querySelector("svg")).toBeTruthy();
    cleanup();

    state.session.status = "unauthenticated";
    render(<ResetPasswordPage />);
    screen.getByRole("button", { name: "Request a new link" }).click();
    expect(state.router.push).toHaveBeenCalledWith("/forgot-password");
    cleanup();

    state.session.status = "authenticated";
    render(<ResetPasswordPage />);
    await waitFor(() => expect(state.router.replace).toHaveBeenCalledWith("/dashboard"));
    cleanup();

    state.params = new URLSearchParams("token=reset-token");
    state.session.status = "authenticated";
    state.auth.resetPassword.mockRejectedValueOnce(new Error("reset failed"));
    render(<ResetPasswordPage />);
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "password" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "different" } });
    fireEvent.submit(form());
    expect(screen.getByText("Passwords do not match.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "password" } });
    fireEvent.submit(form());
    await waitFor(() => expect(screen.getByText("reset failed")).toBeTruthy());
    state.auth.resetPassword.mockResolvedValueOnce(undefined);
    fireEvent.submit(form());
    await waitFor(() => expect(state.router.replace).toHaveBeenCalledWith("/login?reset=1"));
  });

  it("covers Google link challenge, API errors, and successful linking", async () => {
    let resolveChallenge: (() => void) | undefined;
    state.auth.checkGoogleLinkChallenge.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveChallenge = resolve; }));
    const pending = render(<GoogleLinkPage />);
    pending.unmount();
    resolveChallenge?.();
    let rejectChallenge: ((reason?: unknown) => void) | undefined;
    state.auth.checkGoogleLinkChallenge.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectChallenge = reject; }));
    const unmounted = render(<GoogleLinkPage />);
    unmounted.unmount();
    rejectChallenge?.(new Error("late challenge failure"));
    render(<GoogleLinkPage />);
    await waitFor(() => expect((screen.getByRole("button", { name: "Connect and sign in" }) as HTMLButtonElement).disabled).toBe(false));
    state.auth.linkGoogleAccount.mockRejectedValueOnce(new ApiError(429));
    fireEvent.change(screen.getByLabelText("Your StudyFlow password"), { target: { value: "secret" } });
    fireEvent.submit(form());
    await waitFor(() => expect(auth.linkGoogleAccount).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/Too many attempts/)).toBeTruthy());
    state.auth.linkGoogleAccount.mockRejectedValueOnce(new ApiError(400));
    fireEvent.submit(form());
    await waitFor(() => expect(screen.getByText(/link request has expired/)).toBeTruthy());
    state.auth.linkGoogleAccount.mockRejectedValueOnce(new Error("link failed"));
    fireEvent.submit(form());
    await waitFor(() => expect(screen.getByText("link failed")).toBeTruthy());
    state.auth.linkGoogleAccount.mockResolvedValueOnce(undefined);
    state.session.refresh.mockResolvedValue(undefined);
    fireEvent.submit(form());
    await waitFor(() => expect(state.router.replace).toHaveBeenCalledWith("/dashboard"));
    cleanup();

    state.auth.checkGoogleLinkChallenge.mockRejectedValueOnce(new ApiError(401));
    render(<GoogleLinkPage />);
    await waitFor(() => expect(state.router.replace).toHaveBeenCalledWith("/login"));
    cleanup();
    state.auth.checkGoogleLinkChallenge.mockRejectedValueOnce(new Error("challenge failed"));
    render(<GoogleLinkPage />);
    await waitFor(() => expect(screen.getByText("challenge failed")).toBeTruthy());
  });

  it("renders every Google error reason and fallback", async () => {
    for (const reason of ["denied", "invalid", "provider-unavailable", "not-configured", "unknown"]) {
      let view: ReturnType<typeof render>;
      await act(async () => {
        view = render(<GoogleErrorPage params={Promise.resolve({ reason })} />);
        await Promise.resolve();
      });
      await waitFor(() => expect(screen.getByRole("heading")).toBeTruthy());
      view!.unmount();
    }
  });
});

describe("email verification", () => {
  it("renders signed-in and loading awaiting-email states", () => {
    state.session.status = "loading";
    render(<React.StrictMode><VerifyEmailPage /></React.StrictMode>);
    expect(document.querySelector("svg")).toBeTruthy();
    cleanup();
    state.session.status = "authenticated";
    render(<VerifyEmailPage />);
    screen.getByRole("button", { name: "Sign out" }).click();
    expect(state.session.signOut).toHaveBeenCalled();
  });

  it("resends verification and covers rate-limit and generic errors", async () => {
    state.auth.resendVerification.mockResolvedValue({ message: "Sent again" });
    render(<VerifyEmailPage />);
    fireEvent.change(screen.getByLabelText(/Resend to/), { target: { value: "student@example.com" } });
    fireEvent.submit(form());
    await waitFor(() => expect(screen.getByText("Sent again")).toBeTruthy());
    state.auth.resendVerification.mockRejectedValueOnce(new ApiError(429));
    fireEvent.submit(form());
    await waitFor(() => expect(auth.resendVerification).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText(/Too many resend attempts/)).toBeTruthy());
    state.auth.resendVerification.mockRejectedValueOnce(new Error("resend failed"));
    fireEvent.submit(form());
    await waitFor(() => expect(screen.getByText("resend failed")).toBeTruthy());
  });

  it("completes registration after exchange and covers password strengths and API errors", async () => {
    state.params = new URLSearchParams("token=verify-token");
    let resolveVerification: ((value: { signup_token: string }) => void) | undefined;
    state.auth.verifyEmail.mockImplementationOnce(() => new Promise((resolve) => { resolveVerification = resolve; }));
    render(<React.StrictMode><VerifyEmailPage /></React.StrictMode>);
    resolveVerification?.({ signup_token: "signup-1" });
    cleanup();
    state.auth.verifyEmail.mockResolvedValueOnce({ signup_token: "signup-1" });
    render(<VerifyEmailPage />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Finish your account" })).toBeTruthy());
    const password = screen.getByLabelText("Password");
    const confirm = screen.getByLabelText("Confirm Password");
    for (const [value, label] of [["a", "Weak"], ["Abcdefgh", "Fair"], ["Abcdefgh1", "Good"], ["Abcdefgh1234", "Strong"], ["Abcdefgh1234!", "Great"]] as const) {
      fireEvent.change(password, { target: { value } });
      expect(screen.getByText(`${label} password`)).toBeTruthy();
    }
    fireEvent.submit(form());
    expect(screen.getByText("Enter your name.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Full Name"), { target: { value: "Student" } });
    fireEvent.change(password, { target: { value: "short" } });
    fireEvent.change(confirm, { target: { value: "different" } });
    fireEvent.submit(form());
    expect(screen.getByText("Use at least 12 characters.")).toBeTruthy();
    expect(screen.getByText("Passwords do not match.")).toBeTruthy();
    fireEvent.change(password, { target: { value: "Abcdefgh1234!" } });
    fireEvent.change(confirm, { target: { value: "Abcdefgh1234!" } });
    screen.getByRole("combobox").click();
    screen.getByRole("button", { name: "Invoke empty timezone" }).click();
    const timezoneOption = screen.queryByRole("option", { name: /Phnom Penh|UTC/ });
    if (timezoneOption) timezoneOption.click();
    state.auth.completeRegistration.mockRejectedValueOnce(new ApiError(422, "invalid", { name: "Name rejected" }));
    fireEvent.submit(form());
    await waitFor(() => expect(screen.getByText("Name rejected")).toBeTruthy());
    state.auth.completeRegistration.mockRejectedValueOnce(new Error("completion failed"));
    fireEvent.submit(form());
    await waitFor(() => expect(screen.getByText("completion failed")).toBeTruthy());
    state.auth.completeRegistration.mockResolvedValueOnce(undefined);
    fireEvent.submit(form());
    await waitFor(() => expect(state.router.replace).toHaveBeenCalledWith("/login?registered=1"));
    cleanup();

    state.auth.verifyEmail.mockRejectedValueOnce(new Error("expired"));
    render(<VerifyEmailPage />);
    await waitFor(() => expect(screen.getByText("Link no longer valid")).toBeTruthy());
    screen.getByRole("button", { name: "Start over" }).click();
    expect(state.router.push).toHaveBeenCalledWith("/register");
  });
});
