"use client";

import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { TopBar } from "@/components/top-bar";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useSession } from "@/hooks/use-session";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { status } = useSession();

  // Every page in this group needs a session; bounce anonymous visitors and
  // preserve where they were headed so login can return them there.
  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [status, pathname, router]);

  if (status !== "authenticated") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="sr-only">Checking your session…</span>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      {/* The shell owns the viewport height so only `main` scrolls; without
          this the document scrolls and takes the sidebar and header with it. */}
      <SidebarInset className="h-svh overflow-hidden">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b bg-background px-4 md:px-6">
          <SidebarTrigger className="-ml-1 shrink-0" />
          <TopBar />
        </header>
        <main className="flex-1 overflow-auto">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
