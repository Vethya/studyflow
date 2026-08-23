"use client";

import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useSession } from "@/hooks/use-session";

const pageNames: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/calendar": "Calendar",
  "/tasks": "Tasks",
  "/availability": "Availability",
  "/progress": "Progress",
  "/settings": "Settings",
  "/settings/profile": "Profile",
  "/settings/security": "Security",
  "/settings/preferences": "Preferences",
  "/settings/timezone": "Timezone",
  "/settings/system": "Service",
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { status } = useSession();
  const isSettings = pathname.startsWith("/settings/");
  const isTaskDetail = /^\/tasks\/[^/]+$/.test(pathname);
  // Dynamic routes are not in the lookup, so a task detail page would
  // otherwise fall through to "Dashboard".
  const pageName = isTaskDetail ? "Task" : (pageNames[pathname] ?? "Dashboard");
  const parentName = isSettings ? "Settings" : isTaskDetail ? "Tasks" : undefined;
  const parentHref = isSettings ? "/settings/profile" : "/tasks";

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
        <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              {parentName && (
                <>
                  <BreadcrumbItem className="hidden md:block">
                    <BreadcrumbLink href={parentHref}>
                      {parentName}
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator className="hidden md:block" />
                </>
              )}
              <BreadcrumbItem>
                <BreadcrumbPage>{pageName}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </header>
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
