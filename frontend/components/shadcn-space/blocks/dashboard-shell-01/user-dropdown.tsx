"use client";

import Link from "next/link";
import { CircleUserRound, Settings, LogOut, Compass, ChevronsUpDown, Keyboard, Sparkles } from "@/components/icons";
import { Kbd } from "@/components/ui/kbd";
import { useCommandMenu } from "@/components/command-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ThemeSelector } from "@/components/theme-selector";
import { useSession } from "@/hooks/use-session";
import { restartOnboarding, startProductTour } from "@/lib/onboarding";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";

export default function UserDropdown() {
  const { account, signOut } = useSession();
  const { openShortcuts } = useCommandMenu();
  const { isMobile, state, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;
  const closeMobile = () => { if (isMobile) setOpenMobile(false); };
  const initials = account?.name.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase() || "?";
  const avatar = <Avatar className="size-7 shrink-0 rounded-md after:rounded-md"><AvatarImage src={account?.avatarUrl} alt="" referrerPolicy="no-referrer" className="rounded-md" /><AvatarFallback className="rounded-md bg-primary/10 text-[0.6875rem] font-semibold text-primary">{initials}</AvatarFallback></Avatar>;
  const item = "gap-2.5 rounded-md px-2 py-1.5 text-[0.8125rem] [&_svg]:size-4 [&_svg]:text-muted-foreground";
  return (
    <SidebarMenu><SidebarMenuItem>
    <DropdownMenu>
      <DropdownMenuTrigger render={<SidebarMenuButton size="lg" aria-label="Account menu" data-tour="account" title={collapsed ? account?.name || "Account menu" : undefined} className="h-10 w-full min-w-0 gap-2 rounded-lg px-1.5 text-left hover:bg-sidebar-accent data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:justify-center" />}>
        {avatar}
        {!collapsed && <><span className="min-w-0 flex-1 leading-tight"><span className="block truncate text-[0.8125rem] font-medium">{account?.name || "My account"}</span><span className="block truncate text-[0.6875rem] font-normal text-muted-foreground">{account?.email}</span></span><ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /></>}
      </DropdownMenuTrigger>
      <DropdownMenuContent side={isMobile ? "top" : "right"} align="end" sideOffset={8} className="study-shell w-56 max-w-[calc(100vw-2rem)] rounded-lg p-1">
        <DropdownMenuGroup><DropdownMenuLabel className="flex items-center gap-2 px-2 py-1.5">
          {avatar}<div className="min-w-0 leading-tight"><p className="truncate text-[0.8125rem] font-medium text-foreground">{account?.name}</p><p className="truncate text-[0.6875rem] font-normal text-muted-foreground">{account?.email}</p></div>
        </DropdownMenuLabel></DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/settings" />} onClick={closeMobile} className={item}><CircleUserRound /> My profile</DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/settings" />} onClick={closeMobile} className={item}><Settings /> Account settings</DropdownMenuItem>
        <DropdownMenuItem onClick={() => { closeMobile(); startProductTour(); }} className={item}><Sparkles /> Take the tour</DropdownMenuItem>
        <DropdownMenuItem onClick={restartOnboarding} className={item}><Compass /> Show getting started</DropdownMenuItem>
        <DropdownMenuItem onClick={() => { closeMobile(); openShortcuts(); }} className={item}><Keyboard /> Keyboard shortcuts<Kbd aria-hidden className="ms-auto">?</Kbd></DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="flex items-center justify-between gap-2 px-2 py-1 text-[0.8125rem]"><span>Appearance</span><ThemeSelector /></div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void signOut()} className={`${item} text-destructive [&_svg]:text-destructive`}><LogOut /> Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    </SidebarMenuItem></SidebarMenu>
  );
}
