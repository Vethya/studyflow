"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, ArrowLeft, Loader2, Link2 } from "lucide-react";
import { ApiError, auth } from "@/lib/api";
import { describeError } from "@/hooks/use-api";
import { useSession } from "@/hooks/use-session";

/**
 * Reached when a Google sign-in matches an account that already has a
 * password. The backend holds the link challenge in an httpOnly cookie set by
 * the callback, so only the password is collected here — confirming the person
 * signing in with Google owns the existing account.
 */
export default function GoogleLinkPage() {
  const router = useRouter();
  const { refresh } = useSession();

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await auth.linkGoogleAccount(password);
      await refresh();
      router.replace("/dashboard");
    } catch (cause) {
      if (cause instanceof ApiError && cause.isRateLimited) {
        setError("Too many attempts. Wait a few minutes and try again.");
      } else if (cause instanceof ApiError && cause.status === 400) {
        setError("This link request has expired. Start the Google sign-in again.");
      } else {
        setError(describeError(cause));
      }
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-4 py-2 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border bg-muted">
          <Link2 className="h-6 w-6 text-muted-foreground" />
        </div>
        <div className="space-y-1.5">
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Connect Google to your account
          </h1>
          <p className="max-w-xs text-sm text-muted-foreground">
            That Google address already has a StudyFlow account with a password.
            Enter it once and the two will sign you in interchangeably.
          </p>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="password" className="text-xs font-medium">
            Your StudyFlow password
          </Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isSubmitting}
            required
            autoFocus
          />
        </div>

        <Button type="submit" className="w-full font-medium" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Connect and sign in
        </Button>
      </form>

      <Link
        href="/login"
        className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Sign in with a password instead
      </Link>
    </div>
  );
}
