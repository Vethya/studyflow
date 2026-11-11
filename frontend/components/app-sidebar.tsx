"use client";

import Link from "next/link";
import {
  LayoutGrid,
  CalendarDays,
  ListChecks,
  Clock3,
  ChartLine,
} from "@/components/icons";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { NavUser } from "@/components/nav-user";
import { SidebarNav } from "@/components/ui/sidebar-nav";

/** The sidebar is for work navigation; account actions live in the footer menu. */
const MENU = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutGrid },
  { title: "Tasks", url: "/tasks", icon: ListChecks },
  { title: "Calendar", url: "/calendar", icon: CalendarDays },
  { title: "Availability", url: "/availability", icon: Clock3 },
  { title: "Progress", url: "/progress", icon: ChartLine },
];

export function AppSidebar() {
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <Sidebar variant="sidebar" collapsible="icon">
      <SidebarHeader className="py-4 pl-6 pr-3 group-data-[collapsible=icon]:px-2">
        <div className="flex h-11 items-center justify-between gap-2 group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:justify-center">
          <Link
            href="/dashboard"
            onClick={() => {
              if (isMobile) setOpenMobile(false);
            }}
            className="min-w-0 flex-1 truncate font-display text-lg font-bold tracking-tight group-data-[collapsible=icon]:hidden"
          >
            StudyFlow
          </Link>
          <SidebarTrigger className="ml-auto shrink-0 group-data-[collapsible=icon]:ml-0 group-data-[collapsible=icon]:size-8" />
        </div>
      </SidebarHeader>

      {/* Folded, SidebarGroup already supplies the 8px gutter; keeping this
          one too doubled it and pushed every icon hard against the right
          edge of the rail. */}
      <SidebarContent className="px-2 group-data-[collapsible=icon]:px-0">
        <SidebarGroup className="py-1">
          <SidebarGroupLabel className="px-2 text-xs font-medium text-muted-foreground">
            Menu
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarNav items={MENU} size="default" />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t p-2 group-data-[collapsible=icon]:p-2">
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
