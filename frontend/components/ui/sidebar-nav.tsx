"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { SlidingIndicator, useSlidingIndicator } from "@/components/ui/sliding-indicator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SidebarContext } from "@/components/ui/sidebar";

export interface SidebarNavItem {
  id?: string;
  title: string;
  icon: React.ElementType;
  url?: string;
  match?: string;
  onClick?: () => void;
  isActive?: boolean;
}

export interface SidebarNavProps {
  items: readonly SidebarNavItem[];
  /**
   * "default" (40px height, gap-3, px-3) for main app sidebar navigation.
   * "sm" (34px-36px compact height, gap-2, px-2.5) for settings and sub-navigation.
   */
  size?: "default" | "sm";
  /**
   * "vertical" (column) or "responsive" (desktop column, mobile horizontal scroll).
   */
  orientation?: "vertical" | "responsive";
  className?: string;
  /** Active indicator dependency (defaults to pathname). */
  activeKey?: unknown;
  /** Accessible label for the navigation container. */
  ariaLabel?: string;
}

export function SidebarNav({
  items,
  size = "default",
  orientation = "vertical",
  className,
  activeKey,
  ariaLabel,
}: SidebarNavProps) {
  const pathname = usePathname();
  const sidebar = React.useContext(SidebarContext);

  const isCollapsed = sidebar?.state === "collapsed" && !sidebar?.isMobile;

  const isItemActive = React.useCallback(
    (item: SidebarNavItem) => {
      if (typeof item.isActive === "boolean") return item.isActive;
      if (!item.url) return false;
      return item.match
        ? pathname.startsWith(item.match)
        : pathname === item.url || pathname.startsWith(`${item.url}/`);
    },
    [pathname],
  );

  const activeItem = items.find(isItemActive);
  const computedActiveKey =
    activeKey ?? activeItem?.id ?? activeItem?.url ?? pathname;

  const { containerRef, indicator } = useSlidingIndicator<HTMLElement>({
    activeKey: computedActiveKey,
  });

  return (
    <nav
      ref={containerRef}
      aria-label={ariaLabel}
      className={cn(
        "relative",
        orientation === "responsive"
          ? "flex md:flex-col gap-1.5 overflow-x-auto md:overflow-visible pb-1 md:pb-0 scrollbar-none"
          : "flex flex-col gap-1 w-full",
        className,
      )}
    >
      <SlidingIndicator indicator={indicator} />
      {items.map((item) => {
        const Icon = item.icon;
        const active = isItemActive(item);

        const content = (
          <>
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span
              className={cn(
                "truncate",
                orientation === "responsive" && "shrink-0 whitespace-nowrap",
                isCollapsed && "group-data-[collapsible=icon]:hidden",
              )}
            >
              {item.title}
            </span>
          </>
        );

        const itemClassName = cn(
          "relative z-10 flex cursor-pointer select-none items-center rounded-lg text-sm font-medium transition-colors text-left outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
          size === "default"
            ? cn(
                "h-10 gap-3 px-3 w-full",
                "group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:p-2!",
              )
            : cn(
                "h-8.5 gap-2 px-2.5 py-1.5",
                orientation === "responsive"
                  ? "shrink-0 whitespace-nowrap md:w-full"
                  : "w-full",
              ),
          active
            ? indicator.ready
              ? "bg-transparent text-sidebar-accent-foreground hover:bg-transparent hover:text-sidebar-accent-foreground"
              : "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
        );

        const buttonNode = item.url ? (
          <Link
            key={item.url}
            href={item.url}
            data-active={active ? "true" : undefined}
            aria-current={active ? "page" : undefined}
            className={itemClassName}
          >
            {content}
          </Link>
        ) : (
          <button
            key={item.id ?? item.title}
            type="button"
            data-active={active ? "true" : undefined}
            aria-current={active ? "page" : undefined}
            onClick={item.onClick}
            className={itemClassName}
          >
            {content}
          </button>
        );

        if (isCollapsed) {
          return (
            <Tooltip key={item.id ?? item.url ?? item.title}>
              <TooltipTrigger render={buttonNode} />
              <TooltipContent side="right" align="center">
                {item.title}
              </TooltipContent>
            </Tooltip>
          );
        }

        return buttonNode;
      })}
    </nav>
  );
}
