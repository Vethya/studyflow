"use client";

import Link from "next/link";
import { ChartPie, ClipboardList, CalendarDays, Clock3, LayoutDashboard, Settings, type IconComponent } from "@/components/icons";
import { BrandIcon } from "@/components/brand-icon";
import { SidebarGuide } from "@/components/onboarding";
import { ProductTour } from "@/components/product-tour";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarMenuButton, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CommandMenuProvider } from "@/components/command-menu";
import { NavMain } from "./nav-main";
import { SiteHeader } from "./site-header";
import UserDropdown from "./user-dropdown";

export type NavItem = { label?: string; isSection?: boolean; title?: string; icon?: IconComponent; href?: string };
export const navData: NavItem[] = [
  { label: "Workspace", isSection: true },
  { title: "Dashboard", icon: LayoutDashboard, href: "/dashboard" },
  { title: "Tasks", icon: ClipboardList, href: "/tasks" },
  { label: "Study planning", isSection: true },
  { title: "Calendar", icon: CalendarDays, href: "/calendar" },
  { title: "Availability", icon: Clock3, href: "/availability" },
  { title: "Progress", icon: ChartPie, href: "/progress" },
  { label: "Account", isSection: true },
  { title: "Settings", icon: Settings, href: "/settings" },
];

function StudySidebar() {
  const { isMobile, setOpenMobile, state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;
  const close = () => { if (isMobile) setOpenMobile(false); };
  return (
    <Sidebar collapsible="icon" className="border-r border-border bg-background px-0 py-0">
      <div className="study-shell space-dashboard flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      <SidebarHeader className="h-14 justify-center px-4 py-2 group-data-[collapsible=icon]:px-2">
        {collapsed ? (
          <SidebarMenuButton aria-label="Expand navigation" title="Expand navigation" onClick={toggleSidebar} className="size-10! justify-center self-center rounded-lg p-1!">
            <BrandIcon className="size-7! shrink-0" />
          </SidebarMenuButton>
        ) : (
        <div className="flex items-center justify-between gap-2">
          <Link href="/dashboard" aria-label="StudyFlow home" onClick={close} className="flex h-10 min-w-0 items-center gap-2.5 rounded-lg group-data-[collapsible=icon]:justify-center">
            <BrandIcon className="size-7 shrink-0" />
            <span className="text-base font-semibold tracking-tight group-data-[collapsible=icon]:hidden">StudyFlow</span>
          </Link>
          <SidebarTrigger aria-label={isMobile ? "Close navigation" : "Collapse navigation"} title={isMobile ? "Close navigation" : "Collapse navigation"} className="size-8 shrink-0 rounded-lg text-muted-foreground hover:text-foreground" />
        </div>
        )}
      </SidebarHeader>
      <SidebarContent className="gap-0 overflow-hidden px-0">
        <ScrollArea className="min-h-0 flex-1">
          <div className="px-4 pb-5 group-data-[collapsible=icon]:px-2"><NavMain items={navData} /></div>
        </ScrollArea>
      </SidebarContent>
      <div data-tour="getting-started" className="shrink-0 px-2 pb-2 empty:hidden">
        <SidebarGuide />
      </div>
      <SidebarFooter className="border-t border-dashed border-sidebar-border p-2">
        <UserDropdown />
      </SidebarFooter>
      </div>
    </Sidebar>
  );
}

/** Adapted directly from the installed dashboard-shell-01 structure. */
export default function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider className="study-shell space-dashboard" style={{ "--sidebar-width-icon": "4rem" } as React.CSSProperties}>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-md focus:outline-2 focus:outline-offset-2 focus:outline-ring"
      >
        Skip to content
      </a>
      <CommandMenuProvider>
        <StudySidebar />
        <div className="flex h-dvh min-w-0 flex-1 flex-col">
          <header className="z-30 flex h-14 shrink-0 items-center border-b bg-background/85 px-4 backdrop-blur sm:px-6"><SiteHeader /></header>
          <main id="main-content" tabIndex={-1} className="@container/dashboard relative min-h-0 flex-1 overflow-auto pb-[env(safe-area-inset-bottom)]">{children}</main>
        </div>
        <ProductTour />
      </CommandMenuProvider>
    </SidebarProvider>
  );
}
