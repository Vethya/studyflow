"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useSession } from "@/hooks/use-session";

interface GuestOnlyProps {
  children: React.ReactNode;
  redirectTo?: string;
}

/**
 * Keeps authentication entry points useful to signed-out visitors without
 * showing a login or signup form to somebody who already has a session.
 */
export function GuestOnly({ children, redirectTo = "/dashboard" }: GuestOnlyProps) {
  const router = useRouter();
  const { status } = useSession();

  useEffect(() => {
    if (status === "authenticated") {
      router.replace(redirectTo);
    }
  }, [redirectTo, router, status]);

  if (status !== "unauthenticated") {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="sr-only">Checking your session…</span>
      </div>
    );
  }

  return <>{children}</>;
}
