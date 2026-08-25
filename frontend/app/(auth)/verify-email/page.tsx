"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, ArrowLeft, Loader2, Mail, RotateCcw } from "lucide-react";
import { ApiError, auth } from "@/lib/api";
import { describeError } from "@/hooks/use-api";
import { cn } from "@/lib/utils";
import { detectTimezone, withTimezone } from "@/lib/timezones";

function getPasswordStrength(pw: string): { level: number; label: string; color: string } {
  if (pw.length === 0) return { level: 0, label: "", color: "" };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  if (score <= 1) return { level: 1, label: "Weak",   color: "bg-deficit" };
  if (score <= 2) return { level: 2, label: "Fair",   color: "bg-deficit/60" };
  if (score <= 3) return { level: 3, label: "Good",   color: "bg-yellow-500" };
  if (score === 4) return { level: 4, label: "Strong", color: "bg-surplus" };
  return                { level: 5, label: "Great",  color: "bg-surplus" };
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <VerifyEmailFlow />
    </Suspense>
  );
}

/**
 * Two states share this route:
 *
 *   - no `?token=` — the student has just registered and is waiting on the
 *     email, so we show the inbox prompt and a resend control;
 *   - with `?token=` — the emailed link was opened, so the token is exchanged
 *     for a signup token and the account details form is shown.
 */
function VerifyEmailFlow() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  return token ? <CompleteRegistration token={token} /> : <AwaitingEmail />;
}

function AwaitingEmail() {
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  async function handleResend(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setIsSending(true);
    try {
      const { message } = await auth.resendVerification(email);
      setNotice(message);
    } catch (cause) {
      if (cause instanceof ApiError && cause.isRateLimited) {
        setError("Too many resend attempts. Please wait before trying again.");
      } else {
        setError(describeError(cause));
      }
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center text-center space-y-4 py-4">
        <div className="relative">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
            <Mail className="h-8 w-8 text-foreground" />
          </div>
          <span className="absolute -top-1 -right-1 flex h-4 w-4">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-foreground/40 opacity-75" />
            <span className="relative inline-flex h-4 w-4 rounded-full bg-foreground border-2 border-background" />
          </span>
        </div>

        <div className="space-y-1.5">
          <h1 className="text-2xl font-bold tracking-tight">Verify your email</h1>
          <p className="text-sm text-muted-foreground max-w-xs">
            Open the link we emailed you to choose a name and password. The link expires in
            eight hours.
          </p>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleResend} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="resend-email" className="text-xs font-medium">
            Didn&apos;t get it? Resend to
          </Label>
          <Input
            id="resend-email"
            type="email"
            placeholder="student@university.edu"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isSending}
            required
          />
        </div>
        <Button type="submit" variant="outline" className="w-full" disabled={isSending}>
          {isSending ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RotateCcw className="mr-2 h-3.5 w-3.5" />
          )}
          Resend verification email
        </Button>
      </form>

      <div className="rounded-lg border bg-muted/40 p-4 space-y-1.5 text-xs text-muted-foreground">
        <p className="font-medium text-foreground text-sm">Still nothing?</p>
        <ul className="space-y-1 list-disc list-inside">
          <li>Check your spam or junk folder</li>
          <li>Make sure you entered the right email</li>
          <li>Each link can only be used once</li>
        </ul>
      </div>

      <Link
        href="/register"
        className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to sign up
      </Link>
    </div>
  );
}

function CompleteRegistration({ token }: { token: string }) {
  const router = useRouter();

  const [signupToken, setSignupToken] = useState<string | null>(null);
  const [exchangeError, setExchangeError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [timezone, setTimezone] = useState(detectTimezone);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Verification tokens are single use, so the exchange must not be repeated —
  // React Strict Mode would otherwise burn the token on the second mount.
  const exchanged = useRef(false);

  useEffect(() => {
    if (exchanged.current) return;
    exchanged.current = true;

    auth
      .verifyEmail(token)
      .then(({ signup_token }) => setSignupToken(signup_token))
      .catch((cause) => setExchangeError(describeError(cause)));
  }, [token]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!signupToken) return;

    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      await auth.completeRegistration({ signupToken, name, password, timezone });
      // Completing registration does not sign the student in.
      router.replace("/login?registered=1");
    } catch (cause) {
      setError(describeError(cause));
      setIsSubmitting(false);
    }
  }

  if (exchangeError) {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Link no longer valid</h1>
          <p className="text-sm text-muted-foreground">{exchangeError}</p>
        </div>
        <Button className="w-full" onClick={() => router.push("/register")}>
          Start over
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

  if (!signupToken) {
    return (
      <div className="flex flex-col items-center gap-3 py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Verifying your link…</p>
      </div>
    );
  }

  const strength = getPasswordStrength(password);
  const timezoneGroups = withTimezone(timezone);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Finish your account</h1>
        <p className="text-sm text-muted-foreground">
          Your email is verified. Choose how you&apos;ll sign in.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name" className="text-xs font-medium">Full Name</Label>
          <Input
            id="name"
            placeholder="Your full name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isSubmitting}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password" className="text-xs font-medium">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isSubmitting}
            minLength={12}
            required
          />
          <p className="text-[11px] text-muted-foreground">
            At least 12 characters. Passwords found in known breaches are rejected.
          </p>
          {password.length > 0 && (
            <div className="space-y-1">
              <div className="flex gap-1 h-1">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className={cn(
                      "flex-1 rounded-full transition-all duration-300",
                      i <= strength.level ? strength.color : "bg-muted"
                    )}
                  />
                ))}
              </div>
              <p className={cn("text-[11px] font-medium", strength.level <= 2 ? "text-deficit" : "text-surplus")}>
                {strength.label} password
              </p>
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirm" className="text-xs font-medium">Confirm Password</Label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={isSubmitting}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Timezone</Label>
          <Select value={timezone} onValueChange={(v) => v && setTimezone(v as string)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select timezone" />
            </SelectTrigger>
            <SelectContent className="max-h-[280px]">
              {timezoneGroups.map((group) => (
                <SelectGroup key={group.group}>
                  <SelectLabel>{group.group}</SelectLabel>
                  {group.items.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>
                      {tz.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            Used to interpret your deadlines and place study sessions.
          </p>
        </div>

        <Button type="submit" className="w-full font-medium" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Create Account
        </Button>
      </form>
    </div>
  );
}
