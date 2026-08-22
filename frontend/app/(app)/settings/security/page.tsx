"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Loader2, LogOut } from "lucide-react";
import { toast } from "sonner";
import { ApiError, account as accountApi } from "@/lib/api";
import { describeError } from "@/hooks/use-api";
import { useSession } from "@/hooks/use-session";

export default function SecuritySettingsPage() {
  const { signOut } = useSession();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (next !== confirm) {
      setError("New passwords do not match.");
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      await accountApi.changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      // Changing the password invalidates every other session server-side.
      toast.success("Password updated. Other sessions have been signed out.");
    } catch (cause) {
      if (cause instanceof ApiError && cause.isRateLimited) {
        setError("Too many password change attempts. Please wait before trying again.");
      } else {
        setError(describeError(cause));
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="mb-4">
        <h2 className="text-base font-semibold">Security</h2>
        <p className="text-sm text-muted-foreground">
          Manage your password and this browser&apos;s session.
        </p>
      </div>

      <Card>
        <CardContent className="p-6 space-y-6">

          {/* Password */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <h3 className="text-sm font-medium">Change Password</h3>

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="current-pw" className="text-xs font-medium">Current Password</Label>
                <Input
                  id="current-pw"
                  type="password"
                  autoComplete="current-password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  disabled={isSaving}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-pw" className="text-xs font-medium">New Password</Label>
                <Input
                  id="new-pw"
                  type="password"
                  autoComplete="new-password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  minLength={12}
                  disabled={isSaving}
                  required
                />
                <p className="text-[11px] text-muted-foreground">
                  At least 12 characters. Passwords found in known breaches are rejected.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-pw" className="text-xs font-medium">Confirm Password</Label>
                <Input
                  id="confirm-pw"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  disabled={isSaving}
                  required
                />
              </div>
            </div>
            <div className="flex justify-end pt-1">
              <Button size="sm" type="submit" disabled={isSaving}>
                {isSaving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                Update password
              </Button>
            </div>
          </form>

          <Separator />

          {/* Session */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium">This Session</h3>
            <p className="text-xs text-muted-foreground">
              Sessions last seven days and refresh while you are active. The API does not
              expose a list of your other devices, so they cannot be shown or revoked
              individually — changing your password signs all of them out.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-full text-destructive hover:text-destructive hover:bg-destructive/5 border-destructive/20"
              onClick={() => void signOut()}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign out of this browser
            </Button>
          </div>

        </CardContent>
      </Card>
    </div>
  );
}
