"use client";

import { useLayoutEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
import { cn } from "@/lib/utils";

/** The sidebar is for work navigation; account actions live in the footer menu. */
const MENU = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutGrid },
  { title: "Tasks", url: "/tasks", icon: ListChecks },
  { title: "Calendar", url: "/calendar", icon: CalendarDays },
  { title: "Availability", url: "/availability", icon: Clock3 },
  { title: "Progress", url: "/progress", icon: ChartLine },
];

export function AppSidebar() {
  const pathname = usePathname();
  const [menuEl, setMenuEl] = useState<HTMLUListElement | null>(null);
  const [indicator, setIndicator] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
    ready: boolean;
  }>({
    top: 0,
    left: 0,
    width: 0,
    height: 0,
    ready: false,
  });

  const isActive = (item: { url: string; match?: string }) =>
    item.match
      ? pathname.startsWith(item.match)
      : pathname === item.url || pathname.startsWith(`${item.url}/`);

  useLayoutEffect(() => {
    if (!menuEl) return;

    const updateIndicator = () => {
      const activeIndex = MENU.findIndex(isActive);
      const buttons = menuEl.querySelectorAll<HTMLElement>("[data-slot='sidebar-menu-button']");
      const activeBtn =
        menuEl.querySelector<HTMLElement>("[data-active]") ??
        (activeIndex >= 0 ? buttons[activeIndex] : null);

      if (activeBtn) {
        const menuRect = menuEl.getBoundingClientRect();
        const btnRect = activeBtn.getBoundingClientRect();
        setIndicator({
          top: btnRect.top - menuRect.top,
          left: btnRect.left - menuRect.left,
          width: btnRect.width,
          height: btnRect.height,
          ready: true,
        });
      } else {
        setIndicator((prev) => ({ ...prev, ready: false }));
      }
    };

    updateIndicator();
    const observer = new ResizeObserver(updateIndicator);
    observer.observe(menuEl);
    return () => observer.disconnect();
  }, [pathname, menuEl]);

  /*
   * The collapsed overrides are repeated here on purpose.
   *
   * `SidebarMenuButton` already ships `group-data-[collapsible=icon]:size-8!`,
   * but these classes are merged *after* it, and tailwind-merge resolves a
   * later `h-10` against an earlier `size-8` by dropping the size — so the
   * rail rendered 40px-tall buttons with 12px side padding inside a 48px
   * column, pushing every icon off centre. Restating them last wins the merge.
   *
   * `gap-0` matters just as much. The label span collapses to zero width when
   * folded but stays a flex item, and a flex gap is still drawn beside a
   * zero-width child — so the icon sat 6px (half of `gap-3`) left of the
   * highlight pill that is supposed to be centred on it.
   */
  const itemClass = (active: boolean) =>
    cn(
      "relative z-10 h-10 gap-3 rounded-lg px-3 text-sm transition-colors duration-150",
      "group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:p-2!",
      active
        ? indicator.ready
          ? "data-active:bg-transparent font-medium text-sidebar-accent-foreground hover:bg-transparent hover:text-sidebar-accent-foreground"
          : "data-active:bg-sidebar-accent font-medium text-sidebar-accent-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
    );

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
            <SidebarMenu ref={setMenuEl} className="relative gap-1">
              {indicator.ready && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute left-0 top-0 z-0 rounded-lg bg-sidebar-accent transition-[transform,width,height,opacity] duration-250 ease-[cubic-bezier(0.2,0,0,1)]"
                  style={{
                    transform: `translate3d(${indicator.left}px, ${indicator.top}px, 0)`,
                    width: `${indicator.width}px`,
                    height: `${indicator.height}px`,
                  }}
                />
              )}
              {MENU.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    isActive={isActive(item)}
                    tooltip={item.title}
                    className={itemClass(isActive(item))}
                    render={
                      <Link href={item.url}>
                        <item.icon className="size-4" />
                        <span className="group-data-[collapsible=icon]:hidden">
                          {item.title}
                        </span>
                      </Link>
                    }
                  />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

      </SidebarContent>

      <SidebarFooter className="border-t p-2 group-data-[collapsible=icon]:p-2">
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
