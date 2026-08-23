"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Calendar,
  ListTodo,
  Clock,
  TrendingUp,
  Settings,
  GraduationCap,
  LogOut,
  Plus,
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
import { useSession } from "@/hooks/use-session";
import { cn } from "@/lib/utils";

/**
 * Two labelled groups: where the work is, and where the account is.
 * Settings keeps no sub-menu — the settings screen carries its own section
 * nav, and duplicating it here meant two copies of the same navigation.
 */
const MENU = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Tasks", url: "/tasks", icon: ListTodo },
  { title: "Calendar", url: "/calendar", icon: Calendar },
  { title: "Availability", url: "/availability", icon: Clock },
  { title: "Progress", url: "/progress", icon: TrendingUp },
];

const GENERAL = [
  { title: "Settings", url: "/settings/profile", match: "/settings", icon: Settings },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { signOut } = useSession();

  const isActive = (item: { url: string; match?: string }) =>
    item.match
      ? pathname.startsWith(item.match)
      : pathname === item.url || pathname.startsWith(`${item.url}/`);

  const itemClass = (active: boolean) =>
    cn(
      "h-10 gap-3 rounded-lg px-3 text-sm transition-colors",
      active
        ? "bg-sidebar-primary font-medium text-sidebar-primary-foreground hover:bg-sidebar-primary hover:text-sidebar-primary-foreground"
        : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
    );

  return (
    <Sidebar variant="sidebar" collapsible="icon">
      <SidebarHeader className="px-3 py-4">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="h-11 gap-2.5 hover:bg-transparent active:bg-transparent"
              render={
                <Link href="/dashboard">
                  <span className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <GraduationCap className="size-4" />
                  </span>
                  <span className="truncate font-display text-lg font-bold tracking-tight">
                    StudyFlow
                  </span>
                </Link>
              }
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="px-2">
        <SidebarGroup className="py-1">
          <SidebarGroupLabel className="px-2 text-[11px] font-semibold tracking-[0.09em] text-muted-foreground/70">
            MENU
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {MENU.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    isActive={isActive(item)}
                    tooltip={item.title}
                    className={itemClass(isActive(item))}
                    render={
                      <Link href={item.url}>
                        <item.icon className="size-4" />
                        <span>{item.title}</span>
                      </Link>
                    }
                  />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="py-1">
          <SidebarGroupLabel className="px-2 text-[11px] font-semibold tracking-[0.09em] text-muted-foreground/70">
            GENERAL
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {GENERAL.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    isActive={isActive(item)}
                    tooltip={item.title}
                    className={itemClass(isActive(item))}
                    render={
                      <Link href={item.url}>
                        <item.icon className="size-4" />
                        <span>{item.title}</span>
                      </Link>
                    }
                  />
                </SidebarMenuItem>
              ))}
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="Log out"
                  className={itemClass(false)}
                  onClick={() => void signOut()}
                >
                  <LogOut className="size-4" />
                  <span>Log out</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Anchors the rail with the one action that unblocks a new student:
          nothing on the dashboard means anything until there are tasks. */}
      <SidebarFooter className="p-3 group-data-[collapsible=icon]:hidden">
        <div className="rounded-xl bg-primary p-4 text-primary-foreground">
          <p className="font-display text-sm font-semibold">Add your coursework</p>
          <p className="mt-1 text-xs leading-relaxed text-primary-foreground/70">
            StudyFlow can only tell you whether the work fits once it knows what
            you owe and when.
          </p>
          <Link
            href="/tasks"
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary-foreground px-3 py-1.5 text-xs font-medium text-primary transition-opacity hover:opacity-90"
          >
            <Plus className="size-3.5" />
            Add task
          </Link>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
