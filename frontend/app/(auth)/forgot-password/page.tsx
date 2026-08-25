"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, ArrowLeft, Send, CheckCircle2, Loader2 } from "lucide-react";
import { ApiError, auth } from "@/lib/api";
import { describeError } from "@/hooks/use-api";

export default function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      // Always reports success so the response cannot be used to discover
      // which addresses have accounts.
      await auth.forgotPassword(email);
      setSubmitted(true);
    } catch (cause) {
      if (cause instanceof ApiError && cause.isRateLimited) {
        setError("Too many reset requests. Please wait before trying again.");
      } else {
        setError(describeError(cause));
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col items-center text-center space-y-4 py-6">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surplus-soft">
            <CheckCircle2 className="h-7 w-7 text-surplus" />
          </div>
          <div className="space-y-1">
            <h1 className="text-xl font-bold tracking-tight">Check your inbox</h1>
            <p className="text-sm text-muted-foreground">
              If <strong className="text-foreground">{email}</strong> has an account, a reset
              link is on its way. It expires in one hour.
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          className="w-full"
          onClick={() => setSubmitted(false)}
        >
          Send another link
        </Button>

        <Link href="/login" className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Reset password</h1>
        <p className="text-sm text-muted-foreground">
          We&apos;ll send a secure link to your email to reset your password.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <Label htmlFor="email" className="text-xs font-medium">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="student@university.edu"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isSubmitting}
            required
          />
        </div>

        <Button type="submit" className="w-full font-medium" disabled={isSubmitting}>
          {isSubmitting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Send className="mr-2 h-4 w-4" />
          )}
          Send reset link
        </Button>
      </form>

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
