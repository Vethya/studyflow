"use client";

import { use } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowLeft } from "lucide-react";

/**
 * The backend redirects a failed browser Google sign-in here, encoding why in
 * the path segment. See `_browser_redirect` in `backend/.../api/auth.py`.
 */
const REASONS: Record<string, { title: string; detail: string; canRetry: boolean }> = {
  denied: {
    title: "Google sign-in cancelled",
    detail: "You dismissed the Google prompt before it finished. Nothing was changed.",
    canRetry: true,
  },
  invalid: {
    title: "Google sign-in could not be completed",
    detail: "The response from Google was not valid or had already expired. Please try again.",
    canRetry: true,
  },
  "provider-unavailable": {
    title: "Google is temporarily unavailable",
    detail: "Google could not be reached right now. Wait a minute and try again, or sign in with your password.",
    canRetry: true,
  },
  "not-configured": {
    title: "Google sign-in is not available",
    detail: "This deployment has no Google credentials configured. Sign in with your email and password instead.",
    canRetry: false,
  },
};

const FALLBACK = {
  title: "Google sign-in failed",
  detail: "Something went wrong on the way back from Google. Please try again.",
  canRetry: true,
};

export default function GoogleErrorPage({
  params,
}: {
  params: Promise<{ reason: string }>;
}) {
  const { reason } = use(params);
  const { title, detail, canRetry } = REASONS[reason] ?? FALLBACK;

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center text-center space-y-4 py-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-deficit-soft">
          <AlertCircle className="h-7 w-7 text-deficit" />
        </div>
        <div className="space-y-1.5">
          <h1 className="text-xl font-bold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground max-w-xs">{detail}</p>
        </div>
      </div>

      <Button className="w-full" nativeButton={false} render={<Link href="/login" />}>
        {canRetry ? "Back to sign in" : "Sign in with email"}
      </Button>

      <Link
        href="/register"
        className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Create an account instead
      </Link>
    </div>
  );
}
