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
  openShortcuts: vi.fn(),
  reminders: { emailEnabled: true, beforeSessionMinutes: 30, afterSession: true, emailVerified: true, deliveryAvailable: true } as any,
  remindersApi: { getPreferences: vi.fn(), updatePreferences: vi.fn() },
  reminderSetData: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => state.router, useSearchParams: () => state.params }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("sonner", () => ({ toast: state.toast }));
vi.mock("@/hooks/use-session", () => ({ useSession: () => ({ signOut: state.signOut }) }));
vi.mock("@/lib/data-events", () => ({ notifyStudyFlowSessionInvalidated: vi.fn() }));
vi.mock("@/lib/api", () => ({ account: state.account, auth: state.auth, availability: state.availability, reminders: state.remindersApi }));
vi.mock("@/hooks/use-api", () => ({
  describeError: (error: unknown) => error instanceof Error ? error.message : "Unknown error",
  useApi: (key: unknown, loader?: (signal: AbortSignal) => unknown) => {
    // A null key fetches nothing, as with SWR.
    if (key === null) return { isLoading: false, isValidating: false, error: null, reload: vi.fn(), setData: vi.fn(), data: undefined };
    if (loader) void loader(new AbortController().signal);
    const name = Array.isArray(key) ? String(key[0]) : String(key);
    const base = { isLoading: false, isValidating: false, error: null, reload: vi.fn(), setData: vi.fn() };
    if (state.loading && name.includes(state.loading)) return { ...base, data: null, isLoading: true };
    if (name.includes("reminders")) return { ...base, data: state.reminders, setData: state.reminderSetData };
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
vi.mock("@/components/command-menu", () => ({ useCommandMenu: () => ({ openShortcuts: state.openShortcuts }), useModifierKey: () => "Ctrl" }));
vi.mock("@/components/settings-dialogs", () => ({
  AddPasswordDialog: ({ open, onOpenChange }: any) => open ? <div role="dialog">Add password <button onClick={() => onOpenChange(false)}>Close add</button></div> : null,
  ChangePasswordDialog: ({ open, onOpenChange }: any) => open ? <div role="dialog">Change password <button onClick={() => onOpenChange(false)}>Close change</button></div> : null,
  ChangeNameDialog: ({ open, onOpenChange, onSaved }: any) => open ? <div role="dialog">Change name <button onClick={() => { onSaved({ ...state.profile, name: "Renamed" }); onOpenChange(false); }}>Save name</button></div> : null,
  ChangeTimezoneDialog: ({ open, onOpenChange, onSaved }: any) => open ? <div role="dialog">Change timezone <button onClick={() => { onSaved({ ...state.preferences, timezone: "Asia/Tokyo" }); onOpenChange(false); }}>Save timezone</button></div> : null,
  AccountDeletionDialog: ({ open, onOpenChange, onDeleted, onStartGoogle, onGoogleChallengeExpired }: any) => open ? <div role="dialog">Delete account <button onClick={() => onOpenChange(false)}>Close delete</button><button onClick={() => void onStartGoogle()}>Reauthenticate</button><button onClick={onGoogleChallengeExpired}>Reload deletion</button><button onClick={onDeleted}>Confirm deletion</button></div> : null,
}));

import SettingsPage from "./(app)/settings/page";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_EXTENDED_STUDY_PLANNING", "");
  state.params = new URLSearchParams();
  state.profile = { name: "Student", email: "student@example.com", password_set: false };
  state.preferences = { timezone: "UTC", preferred_session_length_minutes: 60, minimum_break_minutes: 10, availability_confirmation_required: true };
  state.identities = [];
  state.deletion = { ready: false };
  state.loading = "";
  state.reminders = { emailEnabled: true, beforeSessionMinutes: 30, afterSession: true, emailVerified: true, deliveryAvailable: true };
  state.account.updatePreferences.mockResolvedValue({ ...state.preferences, preferred_session_length_minutes: 90 });
  state.availability.confirmTimezone.mockResolvedValue(undefined);
  state.auth.startGoogleAccountLink.mockResolvedValue({ authorization_url: "/google-link" });
  state.auth.startGoogleAccountDeletion.mockResolvedValue({ authorization_url: "/google-delete" });
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("settings page", () => {
  it("covers profile, security, preferences, appearance, dialogs, and redirects", async () => {
    render(<SettingsPage />);
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(screen.getAllByRole("region").map((region) => region.getAttribute("aria-label"))).toEqual([
      "Profile",
      "Account & Security",
      "Preferences",
      "Appearance",
      "Sign out",
      "Delete account",
    ]);
    expect(screen.queryByRole("textbox", { name: "Search settings" })).toBeNull();
    screen.getByRole("button", { name: "Change name" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save name" })).toBeTruthy());
    screen.getByRole("button", { name: "Save name" }).click();

    await waitFor(() => expect(screen.getByRole("button", { name: "Add password" })).toBeTruthy());
    screen.getByRole("button", { name: "Add password" }).click();
    await waitFor(() => expect(screen.getByText("Add password")).toBeTruthy());
    screen.getByRole("button", { name: "Close add" }).click();
    screen.getByRole("button", { name: "Connect" }).click();
    await waitFor(() => expect(state.auth.startGoogleAccountLink).toHaveBeenCalled());
    screen.getByRole("button", { name: "Sign out" }).click();
    expect(state.signOut).toHaveBeenCalled();

    await waitFor(() => expect(screen.getByRole("button", { name: "My hours are right" })).toBeTruthy());
    screen.getByRole("button", { name: "My hours are right" }).click();
    await waitFor(() => expect(state.availability.confirmTimezone).toHaveBeenCalled());
    fireEvent.change(screen.getByRole("slider", { name: "Longest session" }), { target: { value: "90" } });
    fireEvent.change(screen.getByRole("slider", { name: "Break between sessions" }), { target: { value: "0" } });
    screen.getByRole("button", { name: "Save" }).click();
    await waitFor(() => expect(state.account.updatePreferences).toHaveBeenCalled());
    screen.getByRole("button", { name: "Change timezone" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save timezone" })).toBeTruthy());
    screen.getByRole("button", { name: "Save timezone" }).click();

    await waitFor(() => expect(screen.getByRole("button", { name: "Theme selector" })).toBeTruthy());

    state.deletion = { ready: true };
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete account" })).toBeTruthy());
    screen.getByRole("button", { name: "Delete account" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Reload deletion" })).toBeTruthy());
    screen.getByRole("button", { name: "Reload deletion" }).click();
    screen.getByRole("button", { name: "Reauthenticate" }).click();
    screen.getByRole("button", { name: "Confirm deletion" }).click();
    expect(state.router.replace).toHaveBeenCalledWith("/login?deleted=1");
  });

  it("covers linked Google, password, and cancellation redirects", async () => {
    state.profile.password_set = true;
    state.identities = [{ provider: "google", email: "linked@example.com" }];
    state.params = new URLSearchParams("account-deletion=cancelled");
    render(<SettingsPage />);
    await waitFor(() => expect(state.router.replace).toHaveBeenCalledWith("/settings"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Change password" })).toBeTruthy());
    screen.getByRole("button", { name: "Change password" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Close change" })).toBeTruthy());
    screen.getByRole("button", { name: "Close change" }).click();
    expect(screen.getByText("linked@example.com")).toBeTruthy();

    expect(screen.getByText("Connected")).toBeTruthy();
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
    expect(document.querySelectorAll("[data-slot='skeleton']").length).toBeGreaterThan(0);
    cleanup();

    state.loading = "";
    state.account.updatePreferences.mockRejectedValueOnce(new Error("preferences failed"));
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByRole("slider", { name: "Longest session" })).toBeTruthy());
    fireEvent.change(screen.getByRole("slider", { name: "Longest session" }), { target: { value: "90" } });
    screen.getByRole("button", { name: "Save" }).click();
    await waitFor(() => expect(state.toast.error).toHaveBeenCalledWith("preferences failed"));

    state.availability.confirmTimezone.mockRejectedValueOnce(new Error("timezone failed"));
    screen.getByRole("button", { name: "My hours are right" }).click();
    await waitFor(() => expect(state.toast.error).toHaveBeenCalledWith("timezone failed"));
  });

  it("switches density, opens the shortcut sheet, and previews the session rhythm", async () => {
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByRole("radiogroup", { name: "Density" })).toBeTruthy());
    fireEvent.click(screen.getByRole("radio", { name: "Compact" }));
    expect(document.documentElement.dataset.density).toBe("compact");
    expect((screen.getByRole("radio", { name: "Compact" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Comfortable" }));
    expect(document.documentElement.dataset.density).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Show shortcuts" }));
    expect(state.openShortcuts).toHaveBeenCalled();

    await waitFor(() => expect(screen.getByText("3 sittings")).toBeTruthy());
    expect(screen.getByText("New plans use these settings.")).toBeTruthy();
    fireEvent.change(screen.getByRole("slider", { name: "Break between sessions" }), { target: { value: "0" } });
    expect(screen.getByText(/back to back/)).toBeTruthy();
    expect(screen.getByText("You have changes that are not saved yet.")).toBeTruthy();
    fireEvent.change(screen.getByRole("slider", { name: "Longest session" }), { target: { value: "90" } });
    expect(screen.getByText("2 sittings")).toBeTruthy();
    window.localStorage.clear();
  });

  it("describes a session that fills the whole example window as one sitting", async () => {
    state.preferences = { ...state.preferences, preferred_session_length_minutes: 180 };
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByText("1 sitting")).toBeTruthy());
  });

  it("reports a failed Google connection", async () => {
    state.auth.startGoogleAccountLink.mockRejectedValueOnce(new Error("link failed"));
    render(<SettingsPage />);
    screen.getByRole("button", { name: "Connect" }).click();
    await waitFor(() => expect(screen.getByText("link failed")).toBeTruthy());
  });

  it("syncs changed preferences and renders the preferences loading state", async () => {
    const view = render(<SettingsPage />);
    await waitFor(() => expect(screen.getByText("Study sessions")).toBeTruthy());
    state.preferences = { ...state.preferences, preferred_session_length_minutes: 90, minimum_break_minutes: 20 };
    view.rerender(<SettingsPage />);
    expect((screen.getByRole("slider", { name: "Longest session" }) as HTMLInputElement).value).toBe("90");
    state.preferences = null as any;
    view.rerender(<SettingsPage />);

    cleanup();
    state.loading = "studyflow/account/preferences";
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByText("Study sessions")).toBeTruthy());
    expect(document.querySelectorAll("[data-slot='skeleton']").length).toBeGreaterThan(0);
  });

  it("covers optional settings data, loading rows, and alternate events", async () => {
    state.profile = null as any;
    state.preferences = null as any;
    render(<SettingsPage />);
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.queryByText("Not added")).toBeNull();
    expect(screen.getByText("Sign in with your Google account")).toBeTruthy();
    expect(screen.getByText("Not set")).toBeTruthy();

    cleanup();
    state.profile = { name: "Student", email: "student@example.com", password_set: false };
    state.preferences = { timezone: undefined, preferred_session_length_minutes: 60, minimum_break_minutes: 10, availability_confirmation_required: false } as any;
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy());
    screen.getByRole("button", { name: "Connect" }).click();
    await waitFor(() => expect(state.auth.startGoogleAccountLink).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("Study sessions")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Longest session numeric" }));

    cleanup();
    state.deletion = { ready: true };
    state.loading = "";
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete account" })).toBeTruthy());
    screen.getByRole("button", { name: "Delete account" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Reauthenticate" })).toBeTruthy());
    screen.getByRole("button", { name: "Reauthenticate" }).click();

    cleanup();
    state.loading = "profile";
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Account & Security" })).toBeTruthy());
    expect(document.querySelectorAll("[data-slot='skeleton']").length).toBeGreaterThan(0);
    cleanup();
    state.loading = "identities";
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Account & Security" })).toBeTruthy());
    expect(document.querySelectorAll("[data-slot='skeleton']").length).toBeGreaterThan(0);

    cleanup();
    state.loading = "";
    state.profile = null as any;
    render(<SettingsPage />);
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
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeTruthy());
    const unavailableSave = screen.getByRole("button", { name: "Save" });
    (unavailableSave as HTMLButtonElement).disabled = false;
    fireEvent.click(unavailableSave);
  });

  it("hides reminder settings until the backend supports them", async () => {
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByText("Where you are, and how StudyFlow paces your sessions.")).toBeTruthy());
    expect(screen.queryByRole("heading", { name: "Reminders" })).toBeNull();
    expect(state.remindersApi.getPreferences).not.toHaveBeenCalled();
  });

  it("saves reminder choices and rolls back when a save fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_EXTENDED_STUDY_PLANNING", "1");
    const saved = { ...state.reminders, beforeSessionMinutes: 60 };
    state.remindersApi.updatePreferences.mockResolvedValueOnce(saved);
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByRole("radiogroup", { name: "Before a session" })).toBeTruthy());
    expect(state.remindersApi.getPreferences).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("radio", { name: "1h before" }));
    await waitFor(() => expect(state.toast.success).toHaveBeenCalledWith("Reminders updated"));
    expect(screen.getByText("Saved.")).toBeTruthy();
    expect(state.remindersApi.updatePreferences).toHaveBeenCalledWith({ emailEnabled: true, beforeSessionMinutes: 60, afterSession: true });
    expect(state.reminderSetData).toHaveBeenLastCalledWith(saved);

    fireEvent.click(screen.getByRole("radio", { name: "30m before" }));
    expect(state.remindersApi.updatePreferences).toHaveBeenCalledTimes(1);

    state.remindersApi.updatePreferences.mockRejectedValueOnce(new Error("Reminder save failed"));
    fireEvent.click(screen.getByRole("switch", { name: "After a session" }));
    await waitFor(() => expect(state.toast.error).toHaveBeenCalledWith("Reminder save failed"));
    expect(screen.queryByText("Saved.")).toBeNull();
    expect(state.reminderSetData).toHaveBeenLastCalledWith(state.reminders);

    state.remindersApi.updatePreferences.mockResolvedValueOnce({ ...state.reminders, emailEnabled: false });
    fireEvent.click(screen.getByRole("switch", { name: "Email reminders" }));
    await waitFor(() => expect(state.remindersApi.updatePreferences).toHaveBeenLastCalledWith({ emailEnabled: false, beforeSessionMinutes: 30, afterSession: true }));
    fireEvent.click(screen.getByRole("radio", { name: "No email before a session" }));
  });

  it("explains reminder notices, disabled controls, and missing data", async () => {
    vi.stubEnv("NEXT_PUBLIC_EXTENDED_STUDY_PLANNING", "1");
    state.reminders = { emailEnabled: false, beforeSessionMinutes: 0, afterSession: false, emailVerified: false, deliveryAvailable: false };
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByText("Email delivery is not switched on here yet")).toBeTruthy());
    expect((screen.getByRole("radio", { name: "No email before a session" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("switch", { name: "After a session" }).hasAttribute("data-disabled")).toBe(true);
    cleanup();

    state.reminders = { ...state.reminders, deliveryAvailable: true };
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByText("Verify your email to get reminders")).toBeTruthy());
    // The account section agrees instead of claiming the address is verified.
    expect(screen.getByText("Not verified")).toBeTruthy();
    expect(screen.queryByText("Verified")).toBeNull();
    cleanup();

    state.reminders = null;
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByText("Your reminder settings could not be loaded.")).toBeTruthy());
    cleanup();

    state.loading = "reminders";
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Preferences" })).toBeTruthy());
    expect(screen.queryByRole("radiogroup", { name: "Before a session" })).toBeNull();
  });
});
