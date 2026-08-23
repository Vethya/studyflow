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
  ChevronsUpDown,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useSession } from "@/hooks/use-session";
import { cn } from "@/lib/utils";

/**
 * Six destinations, one flat list, matching SPEC §17.1.
 *
 * Settings deliberately has no expandable sub-menu here: the settings screen
 * carries its own section nav, and duplicating it in the sidebar meant two
 * copies of the same navigation, one of them hidden behind an accordion.
 */
const NAV_ITEMS = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Tasks", url: "/tasks", icon: ListTodo },
  { title: "Calendar", url: "/calendar", icon: Calendar },
  { title: "Availability", url: "/availability", icon: Clock },
  { title: "Progress", url: "/progress", icon: TrendingUp },
  { title: "Settings", url: "/settings/profile", match: "/settings", icon: Settings },
];

/** Two-letter fallback avatar, e.g. "Meng Heang" → "MH". */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const letters =
    parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0];
  return letters.toUpperCase();
}

export function AppSidebar() {
  const pathname = usePathname();
  const { account, signOut } = useSession();

  return (
    <Sidebar variant="sidebar" collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="h-11 hover:bg-transparent active:bg-transparent"
              render={
                <Link href="/dashboard">
                  <div className="flex aspect-square size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
                    <GraduationCap className="size-4" />
                  </div>
                  <span className="truncate font-display text-base font-semibold tracking-tight">
                    StudyFlow
                  </span>
                </Link>
              }
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="py-3">
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {NAV_ITEMS.map((item) => {
                const isActive = item.match
                  ? pathname.startsWith(item.match)
                  : pathname === item.url || pathname.startsWith(`${item.url}/`);

                return (
                  <SidebarMenuItem key={item.title} className="relative">
                    {/* A rule in the margin marks the current section — the same
                        device the task ledger uses to flag an overdue row. */}
                    <span
                      className={cn(
                        "absolute inset-y-1.5 left-0 w-0.5 rounded-full transition-opacity",
                        isActive ? "bg-sidebar-primary opacity-100" : "opacity-0",
                      )}
                      aria-hidden
                    />
                    <SidebarMenuButton
                      isActive={isActive}
                      tooltip={item.title}
                      className={cn(
                        "h-9 pl-3.5 text-sm",
                        isActive ? "font-medium" : "text-muted-foreground",
                      )}
                      render={
                        <Link href={item.url}>
                          <item.icon className="size-4" />
                          <span>{item.title}</span>
                        </Link>
                      }
                    />
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton className="h-11 data-[state=open]:bg-sidebar-accent">
                    <Avatar className="size-7 rounded-md">
                      <AvatarFallback className="rounded-md bg-secondary font-mono text-[11px] font-medium text-secondary-foreground">
                        {account ? initials(account.name) : "··"}
                      </AvatarFallback>
                    </Avatar>
                    {/* Only the name here — an email address truncates badly at
                        this width, and the menu below has room for it. */}
                    <span className="truncate text-sm">{account?.name ?? "Loading…"}</span>
                    <ChevronsUpDown className="ml-auto size-3.5 text-muted-foreground" />
                  </SidebarMenuButton>
                }
              />
              <DropdownMenuContent
                className="min-w-56"
                side="top"
                align="start"
                sideOffset={8}
              >
                {account && (
                  <>
                    {/* Base UI requires a GroupLabel to sit inside a Group. */}
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="font-normal">
                        <span className="block text-sm font-medium">{account.name}</span>
                        <span className="block truncate font-mono text-xs text-muted-foreground">
                          {account.email}
                        </span>
                      </DropdownMenuLabel>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem render={<Link href="/settings/profile">Profile</Link>} />
                <DropdownMenuItem render={<Link href="/settings/preferences">Preferences</Link>} />
                <DropdownMenuItem render={<Link href="/settings/system">Service status</Link>} />
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => void signOut()}
                >
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
