"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Mail, ArrowLeft, RotateCcw } from "lucide-react";

export default function VerifyEmailPage() {
  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="flex flex-col items-center text-center space-y-4 py-4">
        <div className="relative">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-100">
            <Mail className="h-8 w-8 text-indigo-600" />
          </div>
          {/* Animated ping dot */}
          <span className="absolute -top-1 -right-1 flex h-4 w-4">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
            <span className="relative inline-flex h-4 w-4 rounded-full bg-indigo-500 border-2 border-background" />
          </span>
        </div>

        <div className="space-y-1.5">
          <h1 className="text-2xl font-bold tracking-tight">Verify your email</h1>
          <p className="text-sm text-muted-foreground max-w-xs">
            We sent a confirmation link to{" "}
            <strong className="text-foreground">student@university.edu</strong>.
            Click the link in that email to activate your account.
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-3">
        <Button className="w-full" variant="outline" type="button">
          <svg className="mr-2 h-4 w-4" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 5c-5.56 0-10.66 2.22-14.4 5.83L5.83 14.4C2.22 18.14 0 23.24 0 29c0 13.26 10.74 24 24 24s24-10.74 24-24S37.26 5 24 5zm0 43.2C12.38 48.2 2.8 38.62 2.8 27S12.38 5.8 24 5.8 45.2 15.38 45.2 27 35.62 48.2 24 48.2z" opacity=".1" />
            <path fill="#EA4335" d="M24 5C13.95 5 5 13.95 5 24s8.95 19 19 19 19-8.95 19-19S34.05 5 24 5zm0 34.8C15.72 39.8 9.2 33.28 9.2 25S15.72 10.2 24 10.2 38.8 16.72 38.8 25 32.28 39.8 24 39.8z" opacity=".1" />
            <path fill="#4285F4" d="M44.5 20H24v8.5h11.8C34.7 33.9 29.8 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 5.1 29.6 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21c10.5 0 20-7.7 20-21 0-1.4-.2-2.7-.5-4z" />
          </svg>
          Open Gmail
        </Button>

        <button
          type="button"
          className="flex w-full items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Resend verification email
        </button>
      </div>

      {/* Tips */}
      <div className="rounded-lg border bg-muted/40 p-4 space-y-1.5 text-xs text-muted-foreground">
        <p className="font-medium text-foreground text-sm">Didn't receive it?</p>
        <ul className="space-y-1 list-disc list-inside">
          <li>Check your spam or junk folder</li>
          <li>Make sure you entered the right email</li>
          <li>The link expires in 24 hours</li>
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
