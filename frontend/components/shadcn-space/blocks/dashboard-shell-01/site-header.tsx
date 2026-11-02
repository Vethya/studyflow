"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { TopBar } from "@/components/top-bar";
import NotificationDropdown from "./notification-dropdown";

export function SiteHeader() {
  return (
    <div className="flex w-full min-w-0 items-center justify-between gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <SidebarTrigger aria-label="Open navigation" className="-ml-1 size-9 shrink-0 cursor-pointer md:hidden" />
        <TopBar />
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <NotificationDropdown />
      </div>
    </div>
  );
}
