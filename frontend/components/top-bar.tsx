"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus, Search } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCommandMenu, useModifierKey } from "@/components/command-menu";
import { FocusTimer } from "@/components/focus-timer";

const PAGE_TITLES: Record<string, string> = {
  dashboard: "Dashboard",
  tasks: "Tasks",
  calendar: "Calendar",
  availability: "Availability",
  progress: "Progress",
  settings: "Settings",
  import: "Import",
};

/** "Tasks / Task" for a nested page, so you always know where you are. */
function crumbsFor(pathname: string) {
  const [section, detail] = pathname.split("/").filter(Boolean);
  const title = section ? PAGE_TITLES[section] : undefined;
  if (!title) return [];
  const crumbs = [{ label: title, href: `/${section}` }];
  if (detail) crumbs.push({ label: section === "tasks" ? "Task" : detail[0].toUpperCase() + detail.slice(1), href: pathname });
  return crumbs;
}

/**
 * Where you are on the left; a way to find anything and a way to capture a
 * task on the right. Both actions open the keyboard layer and show the
 * shortcut that skips the click next time.
 */
export function TopBar() {
  const { openMenu, openNewTask } = useCommandMenu();
  const mod = useModifierKey();
  const crumbs = crumbsFor(usePathname() ?? "");

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <nav aria-label="Breadcrumb" className="hidden min-w-0 flex-1 sm:block">
        <ol className="flex min-w-0 items-center gap-1.5 text-sm">
          <li className="shrink-0 text-muted-foreground">StudyFlow</li>
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1;
            return (
              <li key={crumb.href} className="flex min-w-0 items-center gap-1.5">
                <span aria-hidden className="text-muted-foreground/60">/</span>
                {last ? (
                  <span aria-current="page" className="truncate font-medium text-foreground">{crumb.label}</span>
                ) : (
                  <Link href={crumb.href} className="truncate text-muted-foreground transition-colors hover:text-foreground">
                    {crumb.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      <Button
        variant="outline"
        onClick={openMenu}
        aria-label="Search tasks, pages and actions"
        data-tour="search"
        aria-keyshortcuts="Control+K Meta+K"
        className="h-9 w-full min-w-0 shrink justify-start gap-2.5 rounded-lg px-3 font-normal text-muted-foreground hover-fine:text-foreground active:scale-[0.99] sm:w-64 sm:flex-none"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-start">Search…</span>
        <KbdGroup className="hidden sm:inline-flex">
          <Kbd>{mod}</Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
      </Button>
      <FocusTimer />
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon"
              onClick={openNewTask}
              aria-label="Add a task"
              data-tour="add-task"
              aria-keyshortcuts="N"
              className="shrink-0 rounded-lg"
            />
          }
        >
          <Plus aria-hidden />
        </TooltipTrigger>
        <TooltipContent side="bottom" className="flex items-center gap-2">
          Add a task <Kbd className="border-background/25 bg-background/10 text-background">N</Kbd>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
