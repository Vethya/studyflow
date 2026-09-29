// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  params: new URLSearchParams(),
  profile: { name: "Student", email: "student@example.com", password_set: false },
  preferences: { timezone: "UTC", preferred_session_length_minutes: 60, minimum_break_minutes: 10, availability_confirmation_required: true },
  identities: [] as any[],
  deletion: { ready: false },
  router: { replace: vi.fn(), push: vi.fn() },
  signOut: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  loading: "",
  account: { updatePreferences: vi.fn(), getProfile: vi.fn(), getPreferences: vi.fn(), getLinkedIdentities: vi.fn(), getDeletionStatus: vi.fn() },
  auth: { startGoogleAccountLink: vi.fn(), startGoogleAccountDeletion: vi.fn() },
  availability: { confirmTimezone: vi.fn() },
}));

vi.mock("next/navigation", () => ({ useRouter: () => state.router, useSearchParams: () => state.params }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("sonner", () => ({ toast: state.toast }));
vi.mock("@/hooks/use-session", () => ({ useSession: () => ({ signOut: state.signOut }) }));
vi.mock("@/lib/data-events", () => ({ notifyStudyFlowSessionInvalidated: vi.fn() }));
vi.mock("@/lib/api", () => ({ account: state.account, auth: state.auth, availability: state.availability }));
vi.mock("@/hooks/use-api", () => ({
  describeError: (error: unknown) => error instanceof Error ? error.message : "Unknown error",
  useApi: (key: unknown, loader?: (signal: AbortSignal) => unknown) => {
    if (loader) void loader(new AbortController().signal);
    const name = Array.isArray(key) ? String(key[0]) : String(key);
    const base = { isLoading: false, isValidating: false, error: null, reload: vi.fn(), setData: vi.fn() };
    if (state.loading && name.includes(state.loading)) return { ...base, data: null, isLoading: true };
    if (name.includes("profile")) return { ...base, data: state.profile };
    if (name.includes("preferences")) return { ...base, data: state.preferences };
    if (name.includes("identities")) return { ...base, data: state.identities };
    return { ...base, data: state.deletion };
  },
}));
vi.mock("@/components/page-kit", () => ({
  PageShell: ({ children }: any) => <main>{children}</main>,
  PageHeader: ({ title }: any) => <header><h1>{title}</h1></header>,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, ...props }: any) => <button {...props} onClick={onClick}>{children}</button>,
}));
vi.mock("@/components/ui/sidebar-nav", () => ({
  SidebarNav: ({ items }: any) => <nav>{items.map((item: any) => <button key={item.id} onClick={item.onClick}>{item.title}</button>)}</nav>,
}));
vi.mock("@/components/ui/slider", () => ({
  Slider: ({ id, value, onValueChange, getAriaLabel, getAriaValueText }: any) => { getAriaValueText?.(); const label = getAriaLabel(); return <><input id={id} aria-label={label} type="range" value={value[0]} onChange={(e) => onValueChange([Number(e.target.value)])} /><button type="button" aria-label={`${label} numeric`} onClick={() => onValueChange(Number(value[0]))}>Numeric slider event</button></>; },
}));
vi.mock("@/components/theme-selector", () => ({ ThemeSelector: () => <button>Theme selector</button> }));
vi.mock("@/components/settings-dialogs", () => ({
  AddPasswordDialog: ({ open, onOpenChange }: any) => open ? <div role="dialog">Add password <button onClick={() => onOpenChange(false)}>Close add</button></div> : null,
  ChangePasswordDialog: ({ open, onOpenChange }: any) => open ? <div role="dialog">Change password <button onClick={() => onOpenChange(false)}>Close change</button></div> : null,
  ChangeNameDialog: ({ open, onOpenChange, onSaved }: any) => open ? <div role="dialog">Change name <button onClick={() => { onSaved({ ...state.profile, name: "Renamed" }); onOpenChange(false); }}>Save name</button></div> : null,
  ChangeTimezoneDialog: ({ open, onOpenChange, onSaved }: any) => open ? <div role="dialog">Change timezone <button onClick={() => { onSaved({ ...state.preferences, timezone: "Asia/Tokyo" }); onOpenChange(false); }}>Save timezone</button></div> : null,
  AccountDeletionDialog: ({ open, onOpenChange, onDeleted, onStartGoogle, onGoogleChallengeExpired }: any) => open ? <div role="dialog">Delete account <button onClick={() => onOpenChange(false)}>Close delete</button><button onClick={() => void onStartGoogle()}>Reauthenticate</button><button onClick={onGoogleChallengeExpired}>Reload deletion</button><button onClick={onDeleted}>Confirm deletion</button></div> : null,
}));

import SettingsPage from "./(app)/settings/page";

beforeEach(() => {
  state.params = new URLSearchParams();
  state.profile = { name: "Student", email: "student@example.com", password_set: false };
  state.preferences = { timezone: "UTC", preferred_session_length_minutes: 60, minimum_break_minutes: 10, availability_confirmation_required: true };
  state.identities = [];
  state.deletion = { ready: false };
  state.loading = "";
  state.account.updatePreferences.mockResolvedValue({ ...state.preferences, preferred_session_length_minutes: 90 });
  state.availability.confirmTimezone.mockResolvedValue(undefined);
  state.auth.startGoogleAccountLink.mockResolvedValue({ authorization_url: "/google-link" });
  state.auth.startGoogleAccountDeletion.mockResolvedValue({ authorization_url: "/google-delete" });
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("settings page", () => {
  it("covers profile, security, preferences, appearance, dialogs, and redirects", async () => {
    render(<SettingsPage />);
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    screen.getByRole("button", { name: "Change" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save name" })).toBeTruthy());
    screen.getByRole("button", { name: "Save name" }).click();

    screen.getByRole("button", { name: "Account & Security" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Add password" })).toBeTruthy());
    screen.getByRole("button", { name: "Add password" }).click();
    await waitFor(() => expect(screen.getByText("Add password")).toBeTruthy());
    screen.getByRole("button", { name: "Close add" }).click();
    screen.getByRole("button", { name: "Connect" }).click();
    await waitFor(() => expect(state.auth.startGoogleAccountLink).toHaveBeenCalled());
    screen.getByRole("button", { name: "Sign out" }).click();
    expect(state.signOut).toHaveBeenCalled();

    screen.getByRole("button", { name: "Preferences" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "My hours are right" })).toBeTruthy());
    screen.getByRole("button", { name: "My hours are right" }).click();
    await waitFor(() => expect(state.availability.confirmTimezone).toHaveBeenCalled());
    fireEvent.change(screen.getByRole("slider", { name: "Longest session" }), { target: { value: "90" } });
    fireEvent.change(screen.getByRole("slider", { name: "Break between sessions" }), { target: { value: "0" } });
    screen.getByRole("button", { name: "Save" }).click();
    await waitFor(() => expect(state.account.updatePreferences).toHaveBeenCalled());
    screen.getByRole("button", { name: "Change" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save timezone" })).toBeTruthy());
    screen.getByRole("button", { name: "Save timezone" }).click();

    screen.getByRole("button", { name: "Appearance" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Theme selector" })).toBeTruthy());

    state.deletion = { ready: true };
    screen.getByRole("button", { name: "Account & Security" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete account" })).toBeTruthy());
    screen.getByRole("button", { name: "Delete account" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Reload deletion" })).toBeTruthy());
    screen.getByRole("button", { name: "Reload deletion" }).click();
    screen.getByRole("button", { name: "Reauthenticate" }).click();
    screen.getByRole("button", { name: "Confirm deletion" }).click();
    expect(state.router.replace).toHaveBeenCalledWith("/login");
  });

  it("covers search results, linked Google, password, cancellation redirects, and failures", async () => {
    state.profile.password_set = true;
    state.identities = [{ provider: "google", email: "linked@example.com" }];
    state.params = new URLSearchParams("account-deletion=cancelled");
    render(<SettingsPage />);
    await waitFor(() => expect(state.router.replace).toHaveBeenCalledWith("/settings"));
    screen.getByRole("button", { name: "Account & Security" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Change password" })).toBeTruthy());
    screen.getByRole("button", { name: "Change password" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Close change" })).toBeTruthy());
    screen.getByRole("button", { name: "Close change" }).click();
    expect(screen.getByText("linked@example.com")).toBeTruthy();

    const search = screen.getByRole("textbox", { name: "Search settings" });
    fireEvent.change(search, { target: { value: "unknown" } });
    expect(screen.getByText("No settings found")).toBeTruthy();
    screen.getAllByRole("button", { name: "Clear search" }).at(-1)!.click();
    fireEvent.change(search, { target: { value: "profile" } });
    screen.getAllByRole("button", { name: "Clear search" })[0].click();
    fireEvent.change(search, { target: { value: "profile" } });
    screen.getByRole("button", { name: "Change" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save name" })).toBeTruthy());
    screen.getByRole("button", { name: "Save name" }).click();
    fireEvent.change(search, { target: { value: "profile" } });
    expect(screen.getByText("Search results")).toBeTruthy();
    fireEvent.change(search, { target: { value: "sessions" } });
    expect(screen.getByText("Preferences · Study sessions")).toBeTruthy();
    fireEvent.change(search, { target: { value: "appearance" } });
    expect(screen.getByText("Theme")).toBeTruthy();
    fireEvent.change(search, { target: { value: "password" } });
    expect(screen.getByText("Password")).toBeTruthy();
    screen.getByRole("button", { name: "Change password" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Close change" })).toBeTruthy());
    screen.getByRole("button", { name: "Close change" }).click();
    fireEvent.change(search, { target: { value: "google" } });
    expect(screen.getByText("linked@example.com")).toBeTruthy();
    fireEvent.change(search, { target: { value: "sign out" } });
    screen.getByRole("button", { name: "Sign out" }).click();
    expect(state.signOut).toHaveBeenCalled();
    fireEvent.change(search, { target: { value: "delete account" } });
    screen.getByRole("button", { name: "Delete account" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Close delete" })).toBeTruthy());
    screen.getByRole("button", { name: "Close delete" }).click();
    fireEvent.change(search, { target: { value: "timezone" } });
    expect(screen.getByText(/UTC/)).toBeTruthy();
    screen.getByRole("button", { name: "Change" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save timezone" })).toBeTruthy());
    screen.getByRole("button", { name: "Save timezone" }).click();
    screen.getAllByRole("button", { name: "Clear search" }).at(-1)!.click();
    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.getByText("Profile")).toBeTruthy();
  });

  it("covers redirect outcomes, loading skeletons, and mutation failures", async () => {
    state.params = new URLSearchParams("account-deletion=error");
    render(<SettingsPage />);
    await waitFor(() => expect(state.toast.error).toHaveBeenCalled());
    cleanup();

    state.params = new URLSearchParams("account-deletion=ready");
    state.deletion = { ready: true };
    render(<SettingsPage />);
    await waitFor(() => expect(state.router.replace).toHaveBeenCalledWith("/settings"));
    screen.getByRole("button", { name: "Close delete" }).click();
    cleanup();

    state.loading = "profile";
    render(<SettingsPage />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search settings" }), { target: { value: "profile" } });
    expect(document.querySelectorAll("[data-slot='skeleton']").length).toBeGreaterThan(0);
    cleanup();

    state.loading = "";
    state.account.updatePreferences.mockRejectedValueOnce(new Error("preferences failed"));
    render(<SettingsPage />);
    screen.getByRole("button", { name: "Preferences" }).click();
    await waitFor(() => expect(screen.getByRole("slider", { name: "Longest session" })).toBeTruthy());
    fireEvent.change(screen.getByRole("slider", { name: "Longest session" }), { target: { value: "90" } });
    screen.getByRole("button", { name: "Save" }).click();
    await waitFor(() => expect(state.toast.error).toHaveBeenCalledWith("preferences failed"));

    state.availability.confirmTimezone.mockRejectedValueOnce(new Error("timezone failed"));
    screen.getByRole("button", { name: "My hours are right" }).click();
    await waitFor(() => expect(state.toast.error).toHaveBeenCalledWith("timezone failed"));

    state.preferences = { ...state.preferences, preferred_session_length_minutes: 90, minimum_break_minutes: 15 };
    fireEvent.change(screen.getByRole("textbox", { name: "Search settings" }), { target: { value: "" } });
    screen.getByRole("button", { name: "Preferences" }).click();
    fireEvent.change(screen.getByRole("textbox", { name: "Search settings" }), { target: { value: "sessions" } });
    expect((screen.getByRole("slider", { name: "Longest session" }) as HTMLInputElement).value).toBe("90");
  });

  it("reports a failed Google connection from search results", async () => {
    state.auth.startGoogleAccountLink.mockRejectedValueOnce(new Error("link failed"));
    render(<SettingsPage />);
    const search = screen.getByRole("textbox", { name: "Search settings" });
    fireEvent.change(search, { target: { value: "google" } });
    screen.getByRole("button", { name: "Connect" }).click();
    await waitFor(() => expect(screen.getByText("link failed")).toBeTruthy());
  });

  it("syncs changed preferences and renders the preferences loading state", async () => {
    const view = render(<SettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Preferences" }));
    await waitFor(() => expect(screen.getByText("Study sessions")).toBeTruthy());
    state.preferences = { ...state.preferences, preferred_session_length_minutes: 90, minimum_break_minutes: 20 };
    view.rerender(<SettingsPage />);
    expect((screen.getByRole("slider", { name: "Longest session" }) as HTMLInputElement).value).toBe("90");
    state.preferences = null as any;
    view.rerender(<SettingsPage />);

    cleanup();
    state.loading = "studyflow/account/preferences";
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Preferences" }));
    await waitFor(() => expect(screen.getByText("Study sessions")).toBeTruthy());
    expect(document.querySelectorAll("[data-slot='skeleton']").length).toBeGreaterThan(0);
  });

  it("covers optional settings data, loading rows, and alternate events", async () => {
    state.profile = null as any;
    state.preferences = null as any;
    render(<SettingsPage />);
    const search = screen.getByRole("textbox", { name: "Search settings" });
    fireEvent.change(search, { target: { value: "profile" } });
    expect(screen.getByText("—")).toBeTruthy();
    fireEvent.keyDown(search, { key: "Enter" });
    fireEvent.change(search, { target: { value: "password" } });
    expect(screen.getByText("Not added")).toBeTruthy();
    screen.getByRole("button", { name: "Add password" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Close add" })).toBeTruthy());
    screen.getByRole("button", { name: "Close add" }).click();
    fireEvent.change(search, { target: { value: "google" } });
    expect(screen.getByText("Sign in with your Google account")).toBeTruthy();
    fireEvent.change(search, { target: { value: "timezone" } });
    expect(screen.getByText("Not set")).toBeTruthy();
    fireEvent.keyDown(search, { key: "Tab" });

    cleanup();
    state.profile = { name: "Student", email: "student@example.com", password_set: false };
    state.preferences = { timezone: undefined, preferred_session_length_minutes: 60, minimum_break_minutes: 10, availability_confirmation_required: false } as any;
    render(<SettingsPage />);
    screen.getByRole("button", { name: "Account & Security" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy());
    screen.getByRole("button", { name: "Connect" }).click();
    await waitFor(() => expect(state.auth.startGoogleAccountLink).toHaveBeenCalled());
    screen.getByRole("button", { name: "Preferences" }).click();
    await waitFor(() => expect(screen.getByText("Study sessions")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Longest session numeric" }));

    cleanup();
    state.deletion = { ready: true };
    state.loading = "";
    render(<SettingsPage />);
    screen.getByRole("button", { name: "Account & Security" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete account" })).toBeTruthy());
    screen.getByRole("button", { name: "Delete account" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Reauthenticate" })).toBeTruthy());
    screen.getByRole("button", { name: "Reauthenticate" }).click();

    cleanup();
    state.loading = "profile";
    render(<SettingsPage />);
    const loadingProfileSearch = screen.getByRole("textbox", { name: "Search settings" });
    fireEvent.change(loadingProfileSearch, { target: { value: "name" } });
    expect(document.querySelectorAll("[data-slot='skeleton']").length).toBeGreaterThan(0);
    fireEvent.change(loadingProfileSearch, { target: { value: "email" } });
    expect(document.querySelectorAll("[data-slot='skeleton']").length).toBeGreaterThan(0);
    fireEvent.change(loadingProfileSearch, { target: { value: "password" } });
    expect(document.querySelectorAll("[data-slot='skeleton']").length).toBeGreaterThan(0);
    cleanup();
    state.loading = "identities";
    render(<SettingsPage />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search settings" }), { target: { value: "google" } });
    expect(document.querySelectorAll("[data-slot='skeleton']").length).toBeGreaterThan(0);
    cleanup();
    state.loading = "profile";
    render(<SettingsPage />);
    screen.getByRole("button", { name: "Account & Security" }).click();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Account & Security" })).toBeTruthy());
    expect(document.querySelectorAll("[data-slot='skeleton']").length).toBeGreaterThan(0);
    cleanup();
    state.loading = "identities";
    render(<SettingsPage />);
    screen.getByRole("button", { name: "Account & Security" }).click();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Account & Security" })).toBeTruthy());
    expect(document.querySelectorAll("[data-slot='skeleton']").length).toBeGreaterThan(0);

    cleanup();
    state.loading = "";
    state.profile = null as any;
    render(<SettingsPage />);
    screen.getByRole("button", { name: "Account & Security" }).click();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Account & Security" })).toBeTruthy());
    expect(screen.queryByText("Password")).toBeNull();
    const unavailableDelete = screen.getByRole("button", { name: "Delete account" });
    (unavailableDelete as HTMLButtonElement).disabled = false;
    fireEvent.click(unavailableDelete);
    expect(screen.queryByRole("dialog")).toBeNull();

    cleanup();
    state.profile = { name: "Student", email: "student@example.com", password_set: false };
    state.preferences = null as any;
    render(<SettingsPage />);
    screen.getByRole("button", { name: "Preferences" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeTruthy());
    const unavailableSave = screen.getByRole("button", { name: "Save" });
    (unavailableSave as HTMLButtonElement).disabled = false;
    fireEvent.click(unavailableSave);
  });
});
