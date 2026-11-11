"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Lock,
  LogOut,
  Palette,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  User,
} from "@/components/icons";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout } from "@/components/ui/callout";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { PageHeader, PageShell } from "@/components/page-kit";
import { SettingRow } from "@/components/study-kit";
import { useCommandMenu, useModifierKey } from "@/components/command-menu";
import {
  AddPasswordDialog,
  AccountDeletionDialog,
  ChangeNameDialog,
  ChangePasswordDialog,
  ChangeTimezoneDialog,
} from "@/components/settings-dialogs";
import {
  account as accountApi,
  auth,
  availability as availabilityApi,
  reminders as remindersApi,
  type ReminderPreferences,
} from "@/lib/api";
import { describeError, useApi } from "@/hooks/use-api";
import { useNow } from "@/hooks/use-now";
import { useSession } from "@/hooks/use-session";
import { formatDuration } from "@/lib/constants";
import { extendedStudyPlanningEnabled } from "@/lib/feature-flags";
import { clearPerUserStorage, markAccountDeleted } from "@/lib/user-storage";
import { setDensity, useDensity, type Density } from "@/lib/density";
import { detectTimezone, formatOffset } from "@/lib/timezones";
import { cn } from "@/lib/utils";
import { notifyStudyFlowSessionInvalidated } from "@/lib/data-events";
import { ThemeSelector } from "@/components/theme-selector";
import { SWR_KEYS } from "@/lib/swr-keys";
import type { WireStudyPreferences } from "@/lib/api/wire";

const SESSION_LENGTH = { min: 10, max: 240, step: 5 };
const BREAK_LENGTH = { min: 0, max: 120, step: 5 };

const GoogleIcon = () => (
  <svg className="size-5 shrink-0" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
    <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
    <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
    <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C39.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
  </svg>
);

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50svh] items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <SettingsContent />
    </Suspense>
  );
}

function SettingsContent() {
  const { signOut } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();


  const loadProfile = useCallback((s: AbortSignal) => accountApi.getProfile(s), []);
  const loadPreferences = useCallback((s: AbortSignal) => accountApi.getPreferences(s), []);
  const loadIdentities = useCallback((s: AbortSignal) => accountApi.getLinkedIdentities(s), []);
  const deletionOutcome = searchParams.get("account-deletion");
  const deletionReadyFromRedirect = deletionOutcome === "ready";
  const deletionCancelledFromRedirect = deletionOutcome === "cancelled";
  const deletionErrorFromRedirect = deletionOutcome === "error";
  const loadDeletionStatus = useCallback((s: AbortSignal) => accountApi.getDeletionStatus(s), []);

  const profile = useApi(SWR_KEYS.profile, loadProfile);
  const preferences = useApi(SWR_KEYS.studyPreferences, loadPreferences);
  const identities = useApi(SWR_KEYS.identities, loadIdentities);
  const deletionStatus = useApi(SWR_KEYS.deletionStatus, loadDeletionStatus);
  // The reminder settings are the only read that reports verification. This
  // shares the Reminders section's request (same key), so the badge and that
  // section always agree. Without them a signed-in address counts as verified:
  // registration cannot finish without the emailed link.
  const loadReminders = useCallback((s: AbortSignal) => remindersApi.getPreferences(s), []);
  const reminderStatus = useApi<ReminderPreferences>(
    extendedStudyPlanningEnabled() ? SWR_KEYS.reminderPreferences : null,
    loadReminders,
  );
  const emailVerified = reminderStatus.data?.emailVerified;

  const [nameOpen, setNameOpen] = useState(false);
  const [addPasswordOpen, setAddPasswordOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [timezoneOpen, setTimezoneOpen] = useState(false);
  const [isConnectingGoogle, setIsConnectingGoogle] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [deletionOpen, setDeletionOpen] = useState(deletionReadyFromRedirect);

  const googleDeletionReady = deletionStatus.data?.ready === true && !deletionStatus.isLoading;
  const deletionProfileReady =
    profile.data !== null && !profile.isLoading && profile.error === null;

  useEffect(() => {
    if (deletionReadyFromRedirect || deletionCancelledFromRedirect || deletionErrorFromRedirect) {
      if (deletionCancelledFromRedirect) {
        toast.info("Google reauthentication was cancelled. Your account was not deleted.");
      } else if (deletionErrorFromRedirect) {
        toast.error("Google reauthentication could not be completed. Please try again.");
      }
      router.replace("/settings");
    }
  }, [deletionCancelledFromRedirect, deletionErrorFromRedirect, deletionReadyFromRedirect, router]);

  const google = (identities.data ?? []).find((identity) => identity.provider === "google");
  const zone = preferences.data?.timezone;

  async function connectGoogle() {
    setGoogleError(null);
    setIsConnectingGoogle(true);
    try {
      const { authorization_url } = await auth.startGoogleAccountLink(zone ?? detectTimezone());
      window.location.assign(authorization_url);
    } catch (cause) {
      setGoogleError(describeError(cause));
      setIsConnectingGoogle(false);
    }
  }

  async function startGoogleAccountDeletion() {
    deletionStatus.reload();
    const { authorization_url } = await auth.startGoogleAccountDeletion(zone ?? detectTimezone());
    window.location.assign(authorization_url);
  }

  function openDeletionDialog() {
    /* c8 ignore next -- the delete control is disabled until the profile is ready. */
    if (!deletionProfileReady) return;
    setDeletionOpen(true);
    deletionStatus.reload();
  }

  const nameRow = (
    <SettingRow label="Name" description={profile.data?.name ?? "—"}>
      <Button variant="outline" size="sm" aria-label="Change name" onClick={() => setNameOpen(true)}>
        Change
      </Button>
    </SettingRow>
  );

  const emailRow = (
    <SettingRow
      label="Email address"
      description={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="min-w-0 break-all">{profile.data?.email}</span>
          {emailVerified === false ? (
            <span className="flex items-center gap-1 text-xs font-medium text-warning">
              <AlertTriangle className="size-3" aria-hidden />
              Not verified
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs font-medium text-surplus">
              <CheckCircle2 className="size-3" aria-hidden />
              Verified
            </span>
          )}
        </span>
      }
    >
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Lock className="size-3" aria-hidden />
        Can&rsquo;t be changed
      </span>
    </SettingRow>
  );

  const passwordRow = (passwordSet: boolean) => (
    <SettingRow label="Password" description={passwordSet ? "Added" : "Not added"}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => (passwordSet ? setPasswordOpen(true) : setAddPasswordOpen(true))}
      >
        {passwordSet ? "Change password" : "Add password"}
      </Button>
    </SettingRow>
  );

  const googleRow = (
    <SettingRow
      label={
        <span className="flex items-center gap-2">
          <GoogleIcon />
          Google
        </span>
      }
      description={google ? google.email : "Sign in with your Google account"}
    >
      {google ? (
        <span className="flex items-center gap-1.5 text-sm font-medium text-surplus">
          <CheckCircle2 className="size-4" aria-hidden />
          Connected
        </span>
      ) : (
        <Button
          variant="outline"
          className="min-h-10 px-4"
          onClick={() => void connectGoogle()}
          disabled={isConnectingGoogle}
        >
          {isConnectingGoogle ? <Loader2 className="animate-spin" /> : <GoogleIcon />}
          Connect
        </Button>
      )}
    </SettingRow>
  );

  const signOutRow = (
    <SettingRow label="Sign out" description="Ends your session on this device only.">
      <Button variant="outline" size="sm" onClick={() => void signOut()}>
        <LogOut className="size-3.5 text-muted-foreground" />
        Sign out
      </Button>
    </SettingRow>
  );

  const deleteRow = (
    <SettingRow
      label="Delete your StudyFlow account"
      description="Permanently removes your profile, sign-in methods, and planning data. This cannot be undone."
    >
      <Button
        variant="destructive"
        size="sm"
        onClick={openDeletionDialog}
        disabled={!deletionProfileReady}
      >
        <Trash2 className="size-3.5" />
        Delete account
      </Button>
    </SettingRow>
  );

  const timezoneRows = (
    <>
      <SettingRow
        label="Timezone"
        description={
          zone ? (
            <ZoneClock zone={zone} />
          ) : (
            <>
              <span className="font-medium text-foreground">Not set</span>
              <span className="block">Used to read your deadlines and place your sessions.</span>
            </>
          )
        }
      >
        <Button variant="outline" size="sm" aria-label="Change timezone" onClick={() => setTimezoneOpen(true)}>
          Change
        </Button>
      </SettingRow>
      {preferences.data?.availability_confirmation_required && (
        <div className="pt-4">
          <ConfirmTimezone preferences={preferences.data} setPreferences={preferences.setData} />
        </div>
      )}
    </>
  );

  const themeRow = (
    <SettingRow label="Theme" description="Light, dark, AMOLED black, or follow your device.">
      <ThemeSelector />
    </SettingRow>
  );

  const densityRow = (
    <SettingRow
      label="Density"
      description="Compact tightens rows and spacing so more fits on screen."
    >
      <DensityPicker />
    </SettingRow>
  );

  const shortcutsRow = <ShortcutsRow />;
  const extendedPlanning = extendedStudyPlanningEnabled();

  return (
    <PageShell width="narrow">
      <PageHeader
        icon={SlidersHorizontal}
        eyebrow="Account"
        title="Settings"
        description="Your profile, how you sign in, how StudyFlow paces your sessions, and how it looks."
      />

      {googleError && <Callout tone="danger">{googleError}</Callout>}

      <div className="w-full min-w-0 space-y-6">
        <SettingsSection icon={User} title="Profile" description="Your name and the email address you sign in with.">
          <SettingsSubsection>
            {profile.isLoading ? (
              <RowSkeleton rows={2} />
            ) : (
              <>
                {nameRow}
                {emailRow}
              </>
            )}
          </SettingsSubsection>
        </SettingsSection>

        <SettingsSection icon={ShieldCheck} title="Account & Security" description="The ways you can sign in to your account.">
          <SettingsSubsection>
            {profile.isLoading ? (
              <RowSkeleton rows={1} />
            ) : profile.data ? (
              passwordRow(profile.data.password_set)
            ) : null}
            {identities.isLoading ? <RowSkeleton rows={1} /> : googleRow}
          </SettingsSubsection>
        </SettingsSection>

        <SettingsSection
          icon={SlidersHorizontal}
          title="Preferences"
          description={
            extendedPlanning
              ? "Where you are, how StudyFlow paces your sessions, and how it reminds you."
              : "Where you are, and how StudyFlow paces your sessions."
          }
        >
          <SettingsSubsection title="Where you are">
            {preferences.isLoading ? <RowSkeleton rows={1} /> : timezoneRows}
          </SettingsSubsection>
          <SettingsSubsection title="Study sessions">
            <StudySessionsSection preferences={preferences} />
          </SettingsSubsection>
          {extendedPlanning && (
            <SettingsSubsection title="Reminders">
              <ReminderSection />
            </SettingsSubsection>
          )}
        </SettingsSection>

        <SettingsSection icon={Palette} title="Appearance" description="How StudyFlow looks on this device.">
          <SettingsSubsection>
            {themeRow}
            {densityRow}
            {shortcutsRow}
          </SettingsSubsection>
        </SettingsSection>

        <SettingsSection icon={LogOut} title="Sign out" description="Leave StudyFlow on this device.">
          <SettingsSubsection>{signOutRow}</SettingsSubsection>
        </SettingsSection>

        <SettingsSection icon={Trash2} title="Delete account" description="Remove your account and everything in it." tone="danger">
          <SettingsSubsection>{deleteRow}</SettingsSubsection>
        </SettingsSection>
      </div>

      <ChangeNameDialog
        open={nameOpen}
        onOpenChange={setNameOpen}
        currentName={profile.data?.name ?? ""}
        onSaved={(next) => profile.setData(next)}
      />
      <AddPasswordDialog
        open={addPasswordOpen}
        onOpenChange={setAddPasswordOpen}
      />
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
      <ChangeTimezoneDialog
        open={timezoneOpen}
        onOpenChange={setTimezoneOpen}
        preferences={preferences.data}
        onSaved={(next) => preferences.setData(next)}
      />
      <AccountDeletionDialog
        open={deletionOpen}
        onOpenChange={setDeletionOpen}
        passwordSet={profile.data?.password_set ?? null}
        googleReady={googleDeletionReady}
        onStartGoogle={startGoogleAccountDeletion}
        onGoogleChallengeExpired={deletionStatus.reload}
        onDeleted={() => {
          markAccountDeleted();
          clearPerUserStorage();
          notifyStudyFlowSessionInvalidated();
          router.replace("/login?deleted=1");
        }}
      />
    </PageShell>
  );
}

function SettingsSection({
  icon: Icon,
  title,
  description,
  tone,
  children,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  tone?: "danger";
  children: React.ReactNode;
}) {
  const danger = tone === "danger";
  return (
    <Card
      role="region"
      aria-label={title}
      className={cn(danger && "border-destructive/40 bg-destructive/[0.06]")}
    >
      <CardHeader className="grid-cols-[auto_minmax(0,1fr)] pt-2.5 pb-3">
        <span
          aria-hidden
          className={cn(
            "row-span-2 flex size-8 items-center justify-center rounded-lg border bg-card text-muted-foreground shadow-xs",
            danger && "border-destructive/30 text-destructive",
          )}
        >
          <Icon className="size-4" />
        </span>
        <h2 className={cn("min-w-0 text-sm leading-snug font-semibold tracking-tight", danger && "text-destructive")}>
          {title}
        </h2>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="divide-y">{children}</CardContent>
    </Card>
  );
}

function SettingsSubsection({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="py-5 first:pt-0 last:pb-0">
      {title && (
        <h3 className="mb-3 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {title}
        </h3>
      )}
      <div className="divide-y">{children}</div>
    </div>
  );
}

function RowSkeleton({ rows }: { rows: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-40" />
          </div>
          <Skeleton className="h-8 w-20" />
        </div>
      ))}
    </>
  );
}

/** The zone, its offset, and the time there now, so a wrong zone is obvious. */
function ZoneClock({ zone }: { zone: string }) {
  const now = useNow(15_000);
  const time = now.toLocaleTimeString(undefined, {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="font-medium text-foreground">{zone.replace(/_/g, " ")}</span>
      <span className="tabular-nums">{formatOffset(zone)}</span>
      <span className="tabular-nums">· {time} there now</span>
    </span>
  );
}

const DENSITY_OPTIONS: { value: Density; label: string; lines: number; gap: string }[] = [
  { value: "comfortable", label: "Comfortable", lines: 3, gap: "gap-1.5" },
  { value: "compact", label: "Compact", lines: 5, gap: "gap-[3px]" },
];
const SKETCH_WIDTHS = ["85%", "60%", "75%", "50%", "68%"];

/** Two small sketches of a list, one loose and one tight: pick by looking. */
function DensityPicker() {
  const density = useDensity();
  return (
    <div role="radiogroup" aria-label="Density" className="grid grid-cols-2 gap-2">
      {DENSITY_OPTIONS.map((option) => {
        const checked = density === option.value;
        return (
          <label
            key={option.value}
            className={cn(
              "relative flex cursor-pointer flex-col gap-2 rounded-xl border bg-background p-2 transition-[border-color,box-shadow] duration-150 ease-out active:scale-[0.98] has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
              checked ? "border-primary/60 ring-1 ring-primary/25" : "hover-fine:border-foreground/25",
            )}
          >
            <input
              type="radio"
              name="density"
              value={option.value}
              checked={checked}
              onChange={() => setDensity(option.value)}
              className="sr-only"
            />
            <span
              aria-hidden
              className={cn("flex h-12 w-24 flex-col justify-center rounded-md bg-muted/70 px-2", option.gap)}
            >
              {Array.from({ length: option.lines }).map((_, index) => (
                <span key={index} className="flex items-center gap-1">
                  <span className="size-1 shrink-0 rounded-full bg-primary/60" />
                  <span
                    className="h-1 rounded-full bg-foreground/15"
                    style={{ width: SKETCH_WIDTHS[index] }}
                  />
                </span>
              ))}
            </span>
            <span className="flex items-center justify-between gap-1 text-xs font-medium">
              {option.label}
              <CheckCircle2
                aria-hidden
                className={cn("size-3.5 text-primary transition-opacity duration-150", checked ? "opacity-100" : "opacity-0")}
              />
            </span>
          </label>
        );
      })}
    </div>
  );
}

function ShortcutsRow() {
  const { openShortcuts } = useCommandMenu();
  const mod = useModifierKey();
  return (
    <SettingRow
      label="Keyboard shortcuts"
      description={
        <>
          Press <Kbd>?</Kbd> anywhere for the full list, or{" "}
          <KbdGroup>
            <Kbd>{mod}</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>{" "}
          to search and add tasks.
        </>
      }
    >
      <Button variant="outline" size="sm" onClick={openShortcuts}>
        Show shortcuts
      </Button>
    </SettingRow>
  );
}

function ConfirmTimezone({
  preferences,
  setPreferences,
}: {
  preferences: WireStudyPreferences;
  setPreferences: (next: WireStudyPreferences) => void;
}) {
  const [isConfirming, setConfirming] = useState(false);

  async function confirm() {
    setConfirming(true);
    setPreferences({ ...preferences, availability_confirmation_required: false });
    try {
      await availabilityApi.confirmTimezone();
      toast.success("Timezone confirmed");
    } catch (cause) {
      setPreferences(preferences);
      toast.error(describeError(cause));
    } finally {
      setConfirming(false);
    }
  }

  return (
    <Callout
      tone="warning"
      title="Check your study hours in this timezone"
      actions={
        <>
          <Button size="sm" onClick={() => void confirm()} disabled={isConfirming}>
            {isConfirming && <Loader2 className="animate-spin" />}
            My hours are right
          </Button>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href="/availability" />}
          >
            Review them
          </Button>
        </>
      }
    >
      Your weekly windows are stored as clock times, so they now fall at those hours here.
    </Callout>
  );
}

function StudySessionsSection({
  preferences,
}: {
  preferences: ReturnType<typeof useApi<import("@/lib/api/wire").WireStudyPreferences>>;
}) {
  const [sessionLength, setSessionLength] = useState(
    () => preferences.data?.preferred_session_length_minutes ?? 60,
  );
  const [breakLength, setBreakLength] = useState(
    () => preferences.data?.minimum_break_minutes ?? 10,
  );
  const [synced, setSynced] = useState(preferences.data);
  const [isSaving, setSaving] = useState(false);

  if (preferences.data !== synced) {
    setSynced(preferences.data);
    if (preferences.data) {
      setSessionLength(preferences.data.preferred_session_length_minutes);
      setBreakLength(preferences.data.minimum_break_minutes);
    }
  }

  const isDirty =
    preferences.data !== null &&
    (sessionLength !== preferences.data.preferred_session_length_minutes ||
      breakLength !== preferences.data.minimum_break_minutes);

  async function save() {
    /* c8 ignore next -- the save control is disabled when preferences are unavailable. */
    if (!preferences.data) return;
    setSaving(true);
    try {
      const saved = await accountApi.updatePreferences({
        timezone: preferences.data.timezone,
        preferredSessionLength: sessionLength,
        minimumBreak: breakLength,
      });
      preferences.setData(saved);
      toast.success("Preferences saved");
    } catch (cause) {
      toast.error(describeError(cause));
    } finally {
      setSaving(false);
    }
  }

  if (preferences.isLoading) return <Skeleton className="h-28 w-full" />;

  return (
    <div className="space-y-6">
      <SliderRow
        id="session-length"
        label="Longest session"
        value={sessionLength}
        onChange={setSessionLength}
        bounds={SESSION_LENGTH}
        hint="Work longer than this is split across several sittings."
      />
      <SliderRow
        id="break-length"
        label="Break between sessions"
        value={breakLength}
        onChange={setBreakLength}
        bounds={BREAK_LENGTH}
        hint="Set it to zero if you would rather run straight through."
      />

      <SessionRhythm session={sessionLength} rest={breakLength} />

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <p className="text-sm text-muted-foreground">
          {preferences.data === null
            ? "Your current settings could not be loaded."
            : isDirty
              ? "You have changes that are not saved yet."
              : "New plans use these settings."}
        </p>
        <Button size="sm" onClick={() => void save()} disabled={!isDirty || isSaving}>
          {isSaving && <Loader2 className="animate-spin" />}
          Save
        </Button>
      </div>
    </div>
  );
}

interface Choice<T> {
  value: T;
  label: string;
  ariaLabel?: string;
}

/** A row of mutually exclusive pills; picking the current one does nothing. */
function ChoiceGroup<T extends string | number | null>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  options: Choice<T>[];
  disabled?: boolean;
  onChange: (next: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1 rounded-lg bg-muted/60 p-0.5">
      {options.map((option) => {
        const checked = value === option.value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.ariaLabel}
            disabled={disabled}
            onClick={() => {
              if (!checked) onChange(option.value);
            }}
            className={cn(
              "h-7 min-w-10 rounded-md px-2 text-xs font-medium tabular-nums transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
              checked ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover-fine:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

const LEAD_TIME_OPTIONS: Choice<number>[] = [
  { value: 0, label: "Off", ariaLabel: "No email before a session" },
  ...[30, 45, 60, 120].map((minutes) => ({
    value: minutes,
    label: formatDuration(minutes),
    ariaLabel: `${formatDuration(minutes)} before`,
  })),
];

function ReminderSection() {
  const load = useCallback((s: AbortSignal) => remindersApi.getPreferences(s), []);
  const reminders = useApi(SWR_KEYS.reminderPreferences, load);
  const current = reminders.data;
  const [saved, setSaved] = useState(false);

  async function save(patch: Partial<ReminderPreferences>) {
    /* c8 ignore next -- controls only render once preferences have loaded. */
    if (!current) return;
    setSaved(false);
    const next = { ...current, ...patch };
    reminders.setData(next);
    try {
      reminders.setData(
        await remindersApi.updatePreferences({
          emailEnabled: next.emailEnabled,
          beforeSessionMinutes: next.beforeSessionMinutes,
          afterSession: next.afterSession,
        }),
      );
      setSaved(true);
      toast.success("Reminders updated");
    } catch (cause) {
      reminders.setData(current);
      toast.error(describeError(cause));
    }
  }

  if (reminders.isLoading) return <RowSkeleton rows={3} />;
  if (!current) {
    return (
      <p className="text-sm text-muted-foreground">Your reminder settings could not be loaded.</p>
    );
  }

  const off = !current.emailEnabled;
  return (
    <>
      {(!current.deliveryAvailable || !current.emailVerified) && (
        <div className="pb-4">
          {!current.deliveryAvailable ? (
            <Callout tone="info" title="Email delivery is not switched on here yet">
              Your choices are saved and apply as soon as it is.
            </Callout>
          ) : (
            <Callout tone="warning" title="Verify your email to get reminders">
              Reminders only go to a verified address.
            </Callout>
          )}
        </div>
      )}
      <SettingRow
        label="Email reminders"
        description="Get an email around the sessions StudyFlow plans for you."
        htmlFor="reminders-email"
      >
        <Switch
          id="reminders-email"
          checked={current.emailEnabled}
          onCheckedChange={(checked) => void save({ emailEnabled: checked })}
        />
      </SettingRow>
      <SettingRow label="Before a session" description="How early to send the heads-up.">
        <ChoiceGroup
          label="Before a session"
          value={current.beforeSessionMinutes}
          options={LEAD_TIME_OPTIONS}
          disabled={off}
          onChange={(minutes) => void save({ beforeSessionMinutes: minutes })}
        />
      </SettingRow>
      <SettingRow
        label="After a session"
        description="A nudge to record how it went, so estimates keep improving."
        htmlFor="reminders-after"
      >
        <Switch
          id="reminders-after"
          checked={current.afterSession}
          disabled={off}
          onCheckedChange={(checked) => void save({ afterSession: checked })}
        />
      </SettingRow>
      <p role="status" className="border-t pt-4 text-sm text-muted-foreground">
        {saved ? "Saved." : "Changes save as you make them."}
      </p>
    </>
  );
}

const RHYTHM_WINDOW_MINUTES = 180;

/**
 * What three free hours turn into with these settings. Two sliders of minutes
 * are abstract; a row of sittings and breaks is not.
 */
function SessionRhythm({ session, rest }: { session: number; rest: number }) {
  const segments: { kind: "study" | "rest"; minutes: number }[] = [];
  let elapsed = 0;
  while (elapsed < RHYTHM_WINDOW_MINUTES) {
    const study = Math.min(session, RHYTHM_WINDOW_MINUTES - elapsed);
    segments.push({ kind: "study", minutes: study });
    elapsed += study;
    if (elapsed >= RHYTHM_WINDOW_MINUTES || rest <= 0) continue;
    const pause = Math.min(rest, RHYTHM_WINDOW_MINUTES - elapsed);
    segments.push({ kind: "rest", minutes: pause });
    elapsed += pause;
  }
  const sittings = segments.filter((segment) => segment.kind === "study").length;

  return (
    <div className="rounded-xl bg-muted/45 p-3.5">
      <p className="text-xs text-muted-foreground">
        For example, three free hours become{" "}
        <strong className="font-medium text-foreground">
          {sittings} {sittings === 1 ? "sitting" : "sittings"}
        </strong>
        {rest > 0 ? (
          <>
            {" "}with{" "}
            <strong className="font-medium text-foreground">{formatDuration(rest)}</strong> breaks.
          </>
        ) : (
          " back to back."
        )}
      </p>
      <div aria-hidden className="mt-3 flex h-3 gap-0.5">
        {segments.map((segment, index) => (
          <span
            key={index}
            className={cn(
              "h-full min-w-0.5 rounded-full transition-[flex-grow] duration-200 ease-out",
              segment.kind === "study" ? "bg-primary/70" : "bg-border",
            )}
            style={{ flexGrow: segment.minutes, flexBasis: 0 }}
          />
        ))}
      </div>
      <div aria-hidden className="mt-1.5 flex justify-between text-[0.6875rem] tabular-nums text-muted-foreground">
        <span>0h</span>
        <span>1h</span>
        <span>2h</span>
        <span>3h</span>
      </div>
    </div>
  );
}

function SliderRow({
  id,
  label,
  value,
  onChange,
  bounds,
  hint,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (next: number) => void;
  bounds: { min: number; max: number; step: number };
  hint: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        <span className="text-xl leading-none tabular-nums font-semibold tracking-tight">
          {formatDuration(value)}
        </span>
      </div>
      <Slider
        id={id}
        className="mt-3"
        value={[value]}
        min={bounds.min}
        max={bounds.max}
        step={bounds.step}
        onValueChange={(next) => onChange(Array.isArray(next) ? next[0] : next)}
        getAriaLabel={() => label}
        getAriaValueText={() => formatDuration(value)}
      />
      <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
