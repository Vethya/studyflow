"use client";

import Link from "next/link";
import {
  LayoutGrid,
  CalendarDays,
  ListChecks,
  Clock3,
  ChartLine,
  GraduationCap,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
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
  return (
    <Sidebar variant="sidebar" collapsible="icon">
      <SidebarHeader className="px-3 py-4 group-data-[collapsible=icon]:px-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="h-11 gap-2.5 hover:bg-transparent active:bg-transparent group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0!"
              render={
                <Link href="/dashboard">
                  <span className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <GraduationCap className="size-4" />
                  </span>
                  <span className="truncate font-display text-lg font-bold tracking-tight group-data-[collapsible=icon]:hidden">
                    StudyFlow
                  </span>
                </Link>
              }
            />
          </SidebarMenuItem>
        </SidebarMenu>
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
