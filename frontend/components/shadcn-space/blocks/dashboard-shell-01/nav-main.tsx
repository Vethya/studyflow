"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import type { NavItem } from "./app-sidebar";

/** Grouped menu with full-row links; the active page is a raised white pill. */
export function NavMain({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile, state } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;
  return (
    <nav aria-label="Study navigation" className="flex flex-col gap-0.5">
      {items.map(item => {
        if (item.isSection) return (
          <SidebarGroup key={item.label} className="mt-3 border-t border-dashed border-sidebar-border p-0 pt-3 first:mt-0 first:border-t-0 first:pt-0 group-data-[collapsible=icon]:mt-2 group-data-[collapsible=icon]:pt-2">
            <SidebarGroupLabel className="h-7 px-2.5 text-xs font-medium text-muted-foreground">{item.label}</SidebarGroupLabel>
          </SidebarGroup>
        );
        if (!item.title || !item.href) return null;
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        const Icon = item.icon;
        return (
          <SidebarGroup key={item.href} className="p-0"><SidebarMenu><SidebarMenuItem>
            <SidebarMenuButton tooltip={item.title} isActive={active}
              aria-label={item.title} aria-current={active ? "page" : undefined}
              data-tour={`nav${item.href.replaceAll("/", "-")}`}
              render={<Link href={item.href} />}
              onClick={() => { if (isMobile) setOpenMobile(false); }}
              className={cn(
                "group/nav h-9 cursor-pointer rounded-lg border border-transparent px-2.5 py-2 text-sm text-sidebar-foreground/80 transition-colors duration-150 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:justify-center",
                active && "data-active:border-sidebar-border data-active:bg-sidebar-accent data-active:font-medium data-active:text-sidebar-accent-foreground data-active:shadow-xs",
              )}
            >
              {Icon && <Icon className={cn("size-4 shrink-0 transition-colors", active ? "text-sidebar-accent-foreground" : "text-muted-foreground group-hover/nav:text-sidebar-foreground")} aria-hidden />}
              <span className={collapsed ? "hidden" : "min-w-0 flex-1 truncate"}>{item.title}</span>
            </SidebarMenuButton>
          </SidebarMenuItem></SidebarMenu></SidebarGroup>
        );
      })}
    </nav>
  );
}
