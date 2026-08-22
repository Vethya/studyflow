"use client";

import { useCallback, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { account as accountApi, auth } from "@/lib/api";
import { describeError, useApi } from "@/hooks/use-api";
import { useSession } from "@/hooks/use-session";
import { detectTimezone } from "@/lib/timezones";

const GoogleIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
    <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
    <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
    <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C39.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
  </svg>
);

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0])
    .toUpperCase();
}

export default function ProfileSettingsPage() {
  const { setAccount } = useSession();

  const loadProfile = useCallback((signal: AbortSignal) => accountApi.getProfile(signal), []);
  const loadIdentities = useCallback(
    (signal: AbortSignal) => accountApi.getLinkedIdentities(signal),
    [],
  );

  const profile = useApi(loadProfile);
  const identities = useApi(loadIdentities);

  const [name, setName] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Seed the editable field from the server value, and re-seed whenever a new
  // one arrives, without an effect round trip.
  const [syncedProfile, setSyncedProfile] = useState(profile.data);
  if (profile.data !== syncedProfile) {
    setSyncedProfile(profile.data);
    if (profile.data) setName(profile.data.name);
  }

  const google = identities.data?.find((identity) => identity.provider === "google") ?? null;
  const isDirty = profile.data ? name.trim() !== profile.data.name : false;

  async function handleSave() {
    setIsSaving(true);
    try {
      const updated = await accountApi.updateProfile(name.trim());
      profile.setData(updated);
      // Keep the sidebar in step without a second round trip.
      setAccount(updated);
      toast.success("Profile updated");
    } catch (cause) {
      toast.error(describeError(cause));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleConnectGoogle() {
    try {
      const { authorization_url } = await auth.startGoogleSignIn(detectTimezone());
      window.location.href = authorization_url;
    } catch (cause) {
      toast.error(describeError(cause));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="mb-4">
        <h2 className="text-base font-semibold">Profile</h2>
        <p className="text-sm text-muted-foreground">
          Your public profile and linked accounts.
        </p>
      </div>

      {profile.error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>{describeError(profile.error)}</span>
            <Button size="sm" variant="outline" onClick={profile.reload}>Retry</Button>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="p-6 space-y-6">

          {/* Identity summary */}
          <div className="flex items-center gap-5">
            {profile.isLoading || !profile.data ? (
              <>
                <Skeleton className="h-16 w-16 rounded-full" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-44" />
                </div>
              </>
            ) : (
              <>
                <Avatar className="h-16 w-16">
                  <AvatarFallback className="text-lg font-semibold bg-primary text-primary-foreground">
                    {initials(profile.data.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="space-y-1">
                  <p className="text-sm font-medium">{profile.data.name}</p>
                  <p className="text-xs text-muted-foreground">{profile.data.email}</p>
                </div>
              </>
            )}
          </div>

          <Separator />

          {/* Personal info */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">Personal Information</h3>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="full-name" className="text-xs font-medium">Full Name</Label>
                <Input
                  id="full-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={200}
                  disabled={profile.isLoading || isSaving}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs font-medium">Email Address</Label>
                <div className="relative">
                  <Input
                    id="email"
                    value={profile.data?.email ?? ""}
                    disabled
                    className="pr-24 bg-muted/50"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2">
                    <Badge className="bg-emerald-50 text-emerald-700 border-0 text-[11px] flex items-center gap-1 h-5">
                      <CheckCircle2 className="h-3 w-3" />
                      Verified
                    </Badge>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">Email cannot be changed.</p>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <Button size="sm" onClick={handleSave} disabled={!isDirty || isSaving || !name.trim()}>
              {isSaving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              Save changes
            </Button>
          </div>

          <Separator />

          {/* Linked accounts */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Linked Accounts</h3>
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg border bg-white shadow-sm">
                  <GoogleIcon />
                </div>
                <div>
                  <p className="text-sm font-medium">Google</p>
                  <p className="text-xs text-muted-foreground">
                    {identities.isLoading
                      ? "Checking…"
                      : google
                        ? `${google.email} · linked ${new Date(google.linked_at).toLocaleDateString()}`
                        : "Not connected"}
                  </p>
                </div>
              </div>
              {google ? (
                <Badge className="bg-emerald-50 text-emerald-700 border-0 text-[11px]">
                  Connected
                </Badge>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleConnectGoogle}
                  disabled={identities.isLoading}
                >
                  Connect
                </Button>
              )}
            </div>
            {/* The API exposes no unlink endpoint, so disconnecting is not
                offered rather than shown as a control that cannot work. */}
          </div>

        </CardContent>
      </Card>
    </div>
  );
}
