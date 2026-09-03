"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { ApiError, auth } from "@/lib/api";
import { describeError } from "@/hooks/use-api";
import { detectTimezone } from "@/lib/timezones";

const GoogleIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
    <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
    <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
    <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C39.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
  </svg>
);

/**
 * Registration is email-first: this step only asks for an address. The name,
 * password and timezone are collected on /verify-email once the emailed link
 * has been exchanged for a signup token.
 */
export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await auth.register(email);
      setSent(true);
    } catch (cause) {
      if (cause instanceof ApiError && cause.isRateLimited) {
        setError("Too many registration attempts. Please try again later.");
      } else {
        setError(describeError(cause));
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    setIsRedirecting(true);
    try {
      const { authorization_url } = await auth.startGoogleSignIn(detectTimezone());
      window.location.href = authorization_url;
    } catch (cause) {
      setError(describeError(cause));
      setIsRedirecting(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col items-center text-center space-y-4 py-6">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surplus-soft">
            <CheckCircle2 className="h-7 w-7 text-surplus" />
          </div>
          <div className="space-y-1">
            <h1 className="text-xl font-bold tracking-tight">Check your inbox</h1>
            <p className="text-sm text-muted-foreground">
              If <strong className="text-foreground">{email}</strong> is eligible, we sent a
              link to finish setting up your account. It expires in eight hours.
            </p>
          </div>
        </div>

        <Button variant="outline" className="w-full" onClick={() => setSent(false)}>
          Use a different email
        </Button>

        <Link
          href="/login"
          className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to sign in
        </Link>
      </div>
    );
  }

  const isBusy = isSubmitting || isRedirecting;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Create your account</h1>
        <p className="text-sm text-muted-foreground">
          Start planning smarter — it&apos;s free
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Google SSO */}
      <Button
        variant="outline"
        className="w-full"
        type="button"
        onClick={handleGoogle}
        disabled={isBusy}
      >
        {isRedirecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleIcon />}
        <span className="ml-2">Continue with Google</span>
      </Button>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-background px-3 text-xs text-muted-foreground">or register with email</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email" className="text-xs font-medium">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="student@university.edu"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isBusy}
            required
          />
          <p className="text-[11px] text-muted-foreground">
            We&apos;ll email you a link to choose a name and password.
          </p>
        </div>

        <p className="text-[11px] text-muted-foreground">
          By creating an account, you agree to our{" "}
          <Link href="#" className="underline hover:text-foreground">Terms of Service</Link>
          {" "}and{" "}
          <Link href="#" className="underline hover:text-foreground">Privacy Policy</Link>.
        </p>

        <Button type="submit" className="w-full font-medium" disabled={isBusy}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Continue
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-foreground hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
