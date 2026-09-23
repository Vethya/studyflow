"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  Clock4,
  Globe,
  Loader2,
  LogOut,
  Palette,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  User,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout } from "@/components/ui/callout";
import { PageHeader, PageShell } from "@/components/page-kit";
import {
  AddPasswordDialog,
  AccountDeletionDialog,
  ChangeNameDialog,
  ChangePasswordDialog,
  ChangeTimezoneDialog,
} from "@/components/settings-dialogs";
import { account as accountApi, auth, availability as availabilityApi } from "@/lib/api";
import { describeError, useApi } from "@/hooks/use-api";
import { useSession } from "@/hooks/use-session";
import { formatDuration } from "@/lib/constants";
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

type TabId = "profile" | "security" | "preferences" | "appearance";

interface TabItem {
  id: TabId;
  label: string;
  icon: React.ElementType;
}

const TABS: TabItem[] = [
  { id: "profile", label: "Profile", icon: User },
  { id: "security", label: "Account & Security", icon: ShieldCheck },
  { id: "preferences", label: "Preferences", icon: SlidersHorizontal },
  { id: "appearance", label: "Appearance", icon: Palette },
];

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

  const [activeTab, setActiveTab] = useState<TabId>("profile");
  const [searchQuery, setSearchQuery] = useState("");

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
    if (!deletionProfileReady) return;
    setDeletionOpen(true);
    deletionStatus.reload();
  }

  const query = searchQuery.trim().toLowerCase();

  const searchMatches = useMemo(() => {
    if (!query) return null;
    return {
      profileName: "profile name display name".includes(query) || "name".includes(query),
      profileEmail:
        "profile email address verified".includes(query) ||
        (profile.data?.email?.toLowerCase().includes(query) ?? false),
      password: "password change password add password security credentials sign in".includes(query),
      google: "google sign in connect account linked identity authentication".includes(query),
      signOut: "sign out log out device session".includes(query),
      deleteAccount: "delete account remove account wipe data danger permanent".includes(query),
      timezone:
        "timezone time zone clock utc gmt hours availability offset".includes(query) ||
        (zone?.toLowerCase().includes(query) ?? false),
      sessions: "study sessions session length break duration timer sittings schedule pacing".includes(query),
      appearance: "appearance theme light dark amoled oled black mode contrast interface".includes(query),
    };
  }, [query, profile.data?.email, zone]);

  const totalMatches = useMemo(() => {
    if (!searchMatches) return 0;
    return Object.values(searchMatches).filter(Boolean).length;
  }, [searchMatches]);

  return (
    <PageShell width="narrow">
      <PageHeader title="Settings" description="Your account, and how StudyFlow behaves." />

      {googleError && <Callout tone="danger">{googleError}</Callout>}

      <div className="flex flex-col gap-6 md:flex-row md:gap-8 items-start">
        {/* Navigation Sidebar (Vertical on Desktop, Scrollable Pills on Mobile) */}
        <div className="w-full md:w-56 shrink-0 space-y-3">
          {/* Live Search Input */}
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="text"
              placeholder="Search settings..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSearchQuery("");
                }
              }}
              className="h-9 pl-8 pr-8 text-sm"
              aria-label="Search settings"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {/* Navigation Tabs */}
          <nav
            className="flex md:flex-col gap-1.5 overflow-x-auto md:overflow-visible pb-1 md:pb-0 scrollbar-none"
            aria-label="Settings sections"
          >
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = !searchQuery && activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => {
                    setActiveTab(tab.id);
                    setSearchQuery("");
                  }}
                  className={cn(
                    "flex shrink-0 whitespace-nowrap items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-left md:w-full",
                    isActive
                      ? "bg-secondary text-foreground font-semibold shadow-xs"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="shrink-0 whitespace-nowrap">{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Content Area */}
        <div className="min-w-0 flex-1 w-full space-y-6">
          {searchQuery ? (
            /* Live Search Results View */
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b pb-3">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight text-foreground">
                    Search results
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {totalMatches} {totalMatches === 1 ? "result" : "results"} for &ldquo;{searchQuery}&rdquo;
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSearchQuery("")}>
                  Clear search
                </Button>
              </div>

              {totalMatches === 0 ? (
                <div className="rounded-xl border border-dashed p-8 text-center">
                  <Search className="mx-auto size-8 text-muted-foreground/60 mb-3" aria-hidden />
                  <p className="text-sm font-semibold">No settings found</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    No results match &ldquo;{searchQuery}&rdquo;. Try searching for profile, password, timezone, or theme.
                  </p>
                  <Button variant="outline" size="sm" className="mt-4" onClick={() => setSearchQuery("")}>
                    Clear search
                  </Button>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Profile Results */}
                  {(searchMatches?.profileName || searchMatches?.profileEmail) && (
                    <div className="space-y-2">
                      <CategoryBadge label="Profile" icon={User} />
                      <Card>
                        <CardContent className="divide-y p-0 px-4 sm:px-6">
                          {searchMatches.profileName && (
                            <Row label="Name" value={profile.data?.name ?? "—"}>
                              <Button variant="outline" size="sm" onClick={() => setNameOpen(true)}>
                                Change
                              </Button>
                            </Row>
                          )}
                          {searchMatches.profileEmail && (
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
                          )}
                        </CardContent>
                      </Card>
                    </div>
                  )}

                  {/* Security Results */}
                  {(searchMatches?.password ||
                    searchMatches?.google ||
                    searchMatches?.signOut ||
                    searchMatches?.deleteAccount) && (
                    <div className="space-y-2">
                      <CategoryBadge label="Account & Security" icon={ShieldCheck} />
                      <Card>
                        <CardContent className="divide-y p-0 px-4 sm:px-6">
                          {searchMatches.password && (
                            <Row
                              label="Password"
                              value={profile.data?.password_set ? "Added" : "Not added"}
                            >
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  profile.data?.password_set
                                    ? setPasswordOpen(true)
                                    : setAddPasswordOpen(true)
                                }
                              >
                                {profile.data?.password_set ? "Change password" : "Add password"}
                              </Button>
                            </Row>
                          )}
                          {searchMatches.google && (
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
                                <Button
                                  variant="outline"
                                  className="h-auto min-h-11 self-stretch px-5 text-sm"
                                  onClick={() => void connectGoogle()}
                                  disabled={isConnectingGoogle}
                                >
                                  {isConnectingGoogle ? <Loader2 className="animate-spin" /> : <GoogleIcon />}
                                  Connect
                                </Button>
                              )}
                            </Row>
                          )}
                          {searchMatches.signOut && (
                            <Row label="Sign out" value="Ends your session on this device only.">
                              <Button variant="outline" size="sm" onClick={() => void signOut()}>
                                <LogOut className="size-3.5 mr-1 text-muted-foreground" />
                                Sign out
                              </Button>
                            </Row>
                          )}
                          {searchMatches.deleteAccount && (
                            <Row
                              label="Delete your StudyFlow account"
                              value="Permanently removes your profile, sign-in methods, and planning data."
                            >
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={openDeletionDialog}
                                disabled={!deletionProfileReady}
                              >
                                <Trash2 className="size-3.5 mr-1" />
                                Delete account
                              </Button>
                            </Row>
                          )}
                        </CardContent>
                      </Card>
                    </div>
                  )}

                  {/* Preferences Results */}
                  {searchMatches?.timezone && (
                    <div className="space-y-2">
                      <CategoryBadge label="Preferences · Timezone" icon={Globe} />
                      <Card>
                        <CardContent className="divide-y p-0 px-4 sm:px-6">
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

                          {preferences.data?.availability_confirmation_required && (
                            <div className="py-3">
                              <ConfirmTimezone
                                preferences={preferences.data}
                                setPreferences={preferences.setData}
                              />
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </div>
                  )}

                  {searchMatches?.sessions && (
                    <div className="space-y-2">
                      <CategoryBadge label="Preferences · Study sessions" icon={Clock4} />
                      <StudySessionsSection preferences={preferences} />
                    </div>
                  )}

                  {/* Appearance Results */}
                  {searchMatches?.appearance && (
                    <div className="space-y-2">
                      <CategoryBadge label="Appearance" icon={Palette} />
                      <Card>
                        <CardContent className="p-0 px-4 sm:px-6">
                          <Row
                            label="Theme"
                            value="Choose light mode, dark mode, AMOLED black mode, or follow your device."
                          >
                            <ThemeSelector />
                          </Row>
                        </CardContent>
                      </Card>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* Standard Tab View */
            <>
              {activeTab === "profile" && (
                <div className="space-y-5">
                  <SectionHeader
                    icon={User}
                    title="Profile"
                    description="How you appear in StudyFlow."
                  />
                  <Card>
                    <CardContent className="divide-y p-0 px-4 sm:px-6">
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
                    </CardContent>
                  </Card>
                </div>
              )}

              {activeTab === "security" && (
                <div className="space-y-6">
                  <SectionHeader
                    icon={ShieldCheck}
                    title="Account & Security"
                    description="How you access your account and manage your data."
                  />

                  <div className="space-y-3">
                    <h3 className="text-sm font-medium text-muted-foreground">Sign-in methods</h3>
                    <Card>
                      <CardContent className="divide-y p-0 px-4 sm:px-6">
                        {profile.isLoading ? (
                          <RowSkeleton rows={1} />
                        ) : profile.data ? (
                          <Row
                            label="Password"
                            value={profile.data.password_set ? "Added" : "Not added"}
                          >
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                profile.data?.password_set
                                  ? setPasswordOpen(true)
                                  : setAddPasswordOpen(true)
                              }
                            >
                              {profile.data.password_set ? "Change password" : "Add password"}
                            </Button>
                          </Row>
                        ) : null}

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
                              <Button
                                variant="outline"
                                className="h-auto min-h-11 self-stretch px-5 text-sm"
                                onClick={() => void connectGoogle()}
                                disabled={isConnectingGoogle}
                              >
                                {isConnectingGoogle ? <Loader2 className="animate-spin" /> : <GoogleIcon />}
                                Connect
                              </Button>
                            )}
                          </Row>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-sm font-medium text-muted-foreground">Account actions</h3>
                    <Card>
                      <CardContent className="divide-y p-0 px-4 sm:px-6">
                        <Row label="Sign out" value="Ends your session on this device only.">
                          <Button variant="outline" size="sm" onClick={() => void signOut()}>
                            <LogOut className="size-3.5 mr-1 text-muted-foreground" />
                            Sign out
                          </Button>
                        </Row>
                        <Row
                          label="Delete your StudyFlow account"
                          value="Permanently removes your profile, sign-in methods, and planning data."
                        >
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={openDeletionDialog}
                            disabled={!deletionProfileReady}
                          >
                            <Trash2 className="size-3.5 mr-1" />
                            Delete account
                          </Button>
                        </Row>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              )}

              {activeTab === "preferences" && (
                <div className="space-y-6">
                  <SectionHeader
                    icon={SlidersHorizontal}
                    title="Preferences"
                    description="Your timezone and study session pacing."
                  />

                  <div className="space-y-3">
                    <h3 className="text-sm font-medium text-muted-foreground">Timezone</h3>
                    <Card>
                      <CardContent className="divide-y p-0 px-4 sm:px-6">
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

                            {/* Recurring windows re-confirmation */}
                            {preferences.data?.availability_confirmation_required && (
                              <div className="py-3">
                                <ConfirmTimezone
                                  preferences={preferences.data}
                                  setPreferences={preferences.setData}
                                />
                              </div>
                            )}
                          </>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-sm font-medium text-muted-foreground">Study sessions</h3>
                    <StudySessionsSection preferences={preferences} />
                  </div>
                </div>
              )}

              {activeTab === "appearance" && (
                <div className="space-y-5">
                  <SectionHeader
                    icon={Palette}
                    title="Appearance"
                    description="How StudyFlow looks on this device."
                  />
                  <Card>
                    <CardContent className="p-0 px-4 sm:px-6">
                      <Row
                        label="Theme"
                        value="Choose light mode, dark mode, AMOLED black mode, or follow your device."
                      >
                        <ThemeSelector />
                      </Row>
                    </CardContent>
                  </Card>
                </div>
              )}
            </>
          )}
        </div>
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
          notifyStudyFlowSessionInvalidated();
          router.replace("/login");
        }}
      />
    </PageShell>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description?: string;
}) {
  return (
    <div className="border-b pb-3 mb-5">
      <h2 className="text-lg font-semibold tracking-tight text-foreground flex items-center gap-2">
        <Icon className="size-5 text-muted-foreground shrink-0" aria-hidden />
        {title}
      </h2>
      {description && (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

function CategoryBadge({
  label,
  icon: Icon,
}: {
  label: string;
  icon: React.ElementType;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span>{label}</span>
    </div>
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
    <Card>
      <CardContent className="p-4 sm:p-6">
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
      </CardContent>
    </Card>
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
        getAriaLabel={() => label}
        getAriaValueText={() => formatDuration(value)}
      />
      <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
