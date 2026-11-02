"use client";

import DashboardShell from "@/components/shadcn-space/blocks/dashboard-shell-01/app-sidebar";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loader2 } from "@/components/icons";
import { useSession } from "@/hooks/use-session";
import { startStudyFlowWebMcp } from "@/lib/webmcp/register";
import { AccountTimezoneProvider } from "@/hooks/use-account-timezone";
import { PageTransition } from "@/components/page-transition";
import { useWarmCache } from "@/hooks/use-warm-cache";
import { consumeAccountDeleted } from "@/lib/user-storage";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { status, account } = useSession();
  useWarmCache(status === "authenticated" ? (account?.id ?? null) : null);

  // Every page in this group needs a session; bounce anonymous visitors and
  // preserve where they were headed so login can return them there.
  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace(
        consumeAccountDeleted() ? "/login?deleted=1" : `/login?next=${encodeURIComponent(pathname)}`,
      );
    }
  }, [status, pathname, router]);

  useEffect(() => {
    if (status !== "authenticated") return;
    const registration = startStudyFlowWebMcp();
    if (registration === null) return;
    void registration.ready.catch(() => registration.dispose());
    return registration.dispose;
  }, [status]);

  if (status !== "authenticated") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="sr-only">Checking your session…</span>
      </div>
    );
  }

  return (
    <AccountTimezoneProvider>
      <DashboardShell>
        <PageTransition id={pathname}>{children}</PageTransition>
      </DashboardShell>
    </AccountTimezoneProvider>
  );
}
