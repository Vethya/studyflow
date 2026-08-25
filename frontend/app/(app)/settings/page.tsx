"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock4, Globe, Loader2, LogOut, ShieldCheck, User } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout } from "@/components/ui/callout";
import { PageHeader, PageShell } from "@/components/page-kit";
import {
  ChangeNameDialog,
  ChangePasswordDialog,
  ChangeTimezoneDialog,
} from "@/components/settings-dialogs";
import { account as accountApi, availability as availabilityApi } from "@/lib/api";
import { describeError, useApi } from "@/hooks/use-api";
import { useSession } from "@/hooks/use-session";
import { formatDuration } from "@/lib/constants";
import { formatOffset } from "@/lib/timezones";
import { cn } from "@/lib/utils";

const SESSION_LENGTH = { min: 10, max: 240, step: 5 };
const BREAK_LENGTH = { min: 0, max: 120, step: 5 };

const GoogleIcon = () => (
  <svg className="size-5" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
    <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
    <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
    <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C39.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
  </svg>
);

/**
 * Every account setting on one page.
 *
 * The shape is deliberately repetitive: each row states what the setting is,
 * shows its current value underneath, and puts one button on the right that
 * opens it. Nothing is half-editable in place — the page reads as a summary of
 * your account, and changing anything is an explicit step. That is what makes
 * it scannable; a page mixing live inputs with static text has no such rhythm.
 *
 * Study sessions are the exception, and earn it: two sliders that are set by
 * feel rather than by typing a number, so they stay on the page.
 */
export default function SettingsPage() {
  const { signOut } = useSession();

  const loadProfile = useCallback((s: AbortSignal) => accountApi.getProfile(s), []);
  const loadPreferences = useCallback((s: AbortSignal) => accountApi.getPreferences(s), []);
  const loadIdentities = useCallback((s: AbortSignal) => accountApi.getLinkedIdentities(s), []);

  const profile = useApi(loadProfile);
  const preferences = useApi(loadPreferences);
  const identities = useApi(loadIdentities);

  const [nameOpen, setNameOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [timezoneOpen, setTimezoneOpen] = useState(false);

  const google = (identities.data ?? []).find((identity) => identity.provider === "google");
  const zone = preferences.data?.timezone;

  return (
    <PageShell width="narrow">
      <PageHeader title="Settings" description="Your account, and how StudyFlow behaves." />

      <Section icon={User} title="Profile">
        {profile.isLoading ? (
          <RowSkeleton rows={2} />
        ) : (
          <>
            <Row label="Name" value={profile.data?.name ?? "—"}>
              <Button variant="outline" size="sm" onClick={() => setNameOpen(true)}>
                Change
              </Button>
            </Row>
            <Row
              label="Email address"
              value={
                <span className="flex flex-wrap items-center gap-x-1.5">
                  <span className="truncate">{profile.data?.email}</span>
                  <span className="flex items-center gap-1 font-medium text-surplus">
                    <CheckCircle2 className="size-3" />
                    Verified
                  </span>
                </span>
              }
            >
              <span className="text-sm text-muted-foreground">Can&rsquo;t be changed</span>
            </Row>
          </>
        )}
      </Section>

      <Section icon={ShieldCheck} title="Signing in">
        <Row label="Password" value="Last changed when you set it">
          <Button variant="outline" size="sm" onClick={() => setPasswordOpen(true)}>
            Change
          </Button>
        </Row>

        {identities.isLoading ? (
          <RowSkeleton rows={1} />
        ) : (
          <Row
            stretch={!google}
            label={
              <span className="flex items-center gap-2">
                <GoogleIcon />
                Google
              </span>
            }
            value={google ? google.email : "Sign in with your Google account"}
          >
            {google ? (
              <span className="flex items-center gap-1.5 text-sm font-medium text-surplus">
                <CheckCircle2 className="size-4" />
                Connected
              </span>
            ) : (
              /* Sized to the row rather than to the text: this is the only
                 setup action on the page, and a 28px button next to a
                 two-line label read as an afterthought. */
              <Button
                variant="outline"
                nativeButton={false}
                className="h-auto min-h-11 self-stretch px-5 text-sm"
                render={<Link href="/login/google-link" />}
              >
                <GoogleIcon />
                Connect
              </Button>
            )}
          </Row>
        )}
      </Section>

      <Section icon={Globe} title="Timezone">
        {preferences.isLoading ? (
          <RowSkeleton rows={1} />
        ) : (
          <>
            <Row
              label={zone?.replace(/_/g, " ") ?? "Not set"}
              value={
                zone ? (
                  <span className="tabular-nums">
                    {formatOffset(zone)} ·{" "}
                    {new Date().toLocaleTimeString(undefined, {
                      timeZone: zone,
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })}{" "}
                    right now
                  </span>
                ) : (
                  "Used to read your deadlines and place your sessions"
                )
              }
            >
              <Button variant="outline" size="sm" onClick={() => setTimezoneOpen(true)}>
                Change
              </Button>
            </Row>

            {/* SPEC §8.3: recurring windows must be re-confirmed after a change. */}
            {preferences.data?.availability_confirmation_required && (
              <div className="pt-3">
                <ConfirmTimezone onConfirmed={() => preferences.reload()} />
              </div>
            )}
          </>
        )}
      </Section>

      <StudySessionsSection preferences={preferences} />

      <Section icon={LogOut} title="Sign out">
        <Row label="This device" value="Ends your session here only.">
          <Button variant="outline" size="sm" onClick={() => void signOut()}>
            Sign out
          </Button>
        </Row>
      </Section>

      <ChangeNameDialog
        open={nameOpen}
        onOpenChange={setNameOpen}
        currentName={profile.data?.name ?? ""}
        onSaved={(next) => profile.setData(next)}
      />
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
      <ChangeTimezoneDialog
        open={timezoneOpen}
        onOpenChange={setTimezoneOpen}
        preferences={preferences.data}
        onSaved={(next) => preferences.setData(next)}
      />
    </PageShell>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Icon className="size-4" aria-hidden />
        {title}
      </h2>
      <div className="divide-y rounded-xl border bg-card px-4">{children}</div>
    </section>
  );
}

/** What it is, what it is set to, and the one control that changes it. */
function Row({
  label,
  value,
  stretch,
  children,
}: {
  label: React.ReactNode;
  value?: React.ReactNode;
  /** Lets the action fill the row's full height rather than centring in it. */
  stretch?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap justify-between gap-x-4 gap-y-2 py-3.5",
        stretch ? "items-stretch" : "items-center",
      )}
    >
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {value != null && (
          <div className="mt-0.5 truncate text-sm text-muted-foreground">{value}</div>
        )}
      </div>
      {children}
    </div>
  );
}

function RowSkeleton({ rows }: { rows: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center justify-between gap-4 py-3.5">
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

function ConfirmTimezone({ onConfirmed }: { onConfirmed: () => void }) {
  const [isConfirming, setConfirming] = useState(false);

  async function confirm() {
    setConfirming(true);
    try {
      await availabilityApi.confirmTimezone();
      toast.success("Timezone confirmed");
      onConfirmed();
    } catch (cause) {
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
  const [sessionLength, setSessionLength] = useState(60);
  const [breakLength, setBreakLength] = useState(10);
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

  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Clock4 className="size-4" aria-hidden />
        Study sessions
      </h2>
      <div className="rounded-xl border bg-card p-4">
        {preferences.isLoading ? (
          <Skeleton className="h-28 w-full" />
        ) : (
          <div className="space-y-5">
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

            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <p className="text-sm text-muted-foreground">
                Sittings of up to{" "}
                <strong className="font-medium text-foreground">
                  {formatDuration(sessionLength)}
                </strong>
                , at least{" "}
                <strong className="font-medium text-foreground">
                  {formatDuration(breakLength)}
                </strong>{" "}
                apart.
              </p>
              <Button size="sm" onClick={() => void save()} disabled={!isDirty || isSaving}>
                {isSaving && <Loader2 className="animate-spin" />}
                Save
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
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
        <span className="font-display text-lg font-bold tabular-nums">
          {formatDuration(value)}
        </span>
      </div>
      <Slider
        id={id}
        className="mt-2.5"
        value={[value]}
        min={bounds.min}
        max={bounds.max}
        step={bounds.step}
        onValueChange={(next) => onChange(Array.isArray(next) ? next[0] : next)}
      />
      <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
