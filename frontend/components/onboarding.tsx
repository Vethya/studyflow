"use client";

import { useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowRight, Check, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { useApi } from "@/hooks/use-api";
import { availability as availabilityApi, scheduling, tasks as tasksApi } from "@/lib/api";
import {
  gettingStartedHidden,
  onboardingProgress,
  onboardingSteps,
  rememberGettingStartedHidden,
  subscribeToOnboardingFlags,
  type OnboardingState,
} from "@/lib/onboarding";
import { SWR_KEYS } from "@/lib/swr-keys";
import { cn } from "@/lib/utils";

/**
 * Reads the same SWR keys as the dashboard, so the guide never adds a request
 * of its own and ticks a step off the moment a page saves the data behind it.
 */
function useOnboardingState(): { state: OnboardingState; ready: boolean } {
  const loadTasks = useCallback((s: AbortSignal) => tasksApi.listTasks({}, s), []);
  const loadWindows = useCallback((s: AbortSignal) => availabilityApi.listWindows(s), []);
  const tasks = useApi(SWR_KEYS.tasks, loadTasks);
  const windows = useApi(SWR_KEYS.availabilityWindows, loadWindows);
  const loadSchedule = useCallback((s: AbortSignal) => scheduling.getActiveSchedule(s), []);
  const schedule = useApi(SWR_KEYS.activeSchedule, loadSchedule);

  const sessions = schedule.data?.sessions ?? [];
  return {
    state: {
      weeklyWindows: windows.data?.length ?? 0,
      openTasks: (tasks.data ?? []).filter((task) => task.status !== "Completed").length,
      plannedSessions: sessions.length,
      recordedOutcomes: sessions.filter((session) => session.outcome !== undefined).length,
    },
    // A student with no sessions yet has no schedule at all (`null`), so the
    // schedule counts as ready once it has stopped loading, not once it exists.
    ready:
      tasks.data !== null &&
      windows.data !== null &&
      !schedule.isLoading &&
      !tasks.error &&
      !windows.error &&
      !schedule.error,
  };
}

function ProgressRing({ done, total, className }: { done: number; total: number; className?: string }) {
  const radius = 9;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg viewBox="0 0 24 24" className={cn("size-6 shrink-0 -rotate-90", className)} aria-hidden>
      <circle cx="12" cy="12" r={radius} fill="none" strokeWidth="2.5" className="stroke-border" />
      <circle
        cx="12"
        cy="12"
        r={radius}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - done / total)}
        className="stroke-primary transition-[stroke-dashoffset] duration-500 ease-out"
      />
    </svg>
  );
}

/**
 * The four setup steps, kept in the sidebar above the account menu so they
 * follow the student from page to page. Each step ticks itself off from real
 * data; the guide leaves for good once every step is done, or when hidden.
 */
export function SidebarGuide() {
  const { isMobile, setOpenMobile, state: sidebarState } = useSidebar();
  const collapsed = sidebarState === "collapsed" && !isMobile;
  // `true` on the server, so the guide never flashes in before the browser's
  // own answer arrives.
  const hidden = useSyncExternalStore(subscribeToOnboardingFlags, gettingStartedHidden, () => true);
  const { state, ready } = useOnboardingState();

  const steps = onboardingSteps(state);
  const progress = onboardingProgress(steps);

  if (!ready || hidden || progress.next === null) return null;
  const next = progress.next;
  const close = () => { if (isMobile) setOpenMobile(false); };
  const summary = `${progress.done} of ${progress.total} done`;

  if (collapsed) {
    return (
      <SidebarMenu><SidebarMenuItem>
        <SidebarMenuButton
          tooltip={`Getting started · ${summary} · Next: ${next.title}`}
          aria-label={`Getting started, ${summary}. Next: ${next.title}`}
          render={<Link href={next.href} />}
          className="mx-auto size-10! justify-center rounded-lg"
        >
          <ProgressRing done={progress.done} total={progress.total} className="size-5!" />
        </SidebarMenuButton>
      </SidebarMenuItem></SidebarMenu>
    );
  }

  return (
    <section aria-labelledby="sidebar-guide-title" className="sidebar-guide rounded-lg border bg-background/70 p-2.5 shadow-xs">
      <div className="flex items-center gap-2.5 ps-0.5">
        <ProgressRing done={progress.done} total={progress.total} />
        <div className="min-w-0 flex-1">
          <h2 id="sidebar-guide-title" className="truncate text-sm font-medium leading-5">Getting started</h2>
          <p className="text-xs leading-4 text-muted-foreground tabular-nums">{summary}</p>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Hide getting started"
          title="Hide getting started"
          onClick={rememberGettingStartedHidden}
          className="text-muted-foreground hover:text-foreground"
        >
          <X aria-hidden />
        </Button>
      </div>
      <ol className="mt-2 grid gap-px">
        {steps.map((step, index) => {
          const isNext = step.id === next.id;
          return (
            <li key={step.id}>
              <Link
                href={step.href}
                onClick={close}
                aria-current={isNext ? "step" : undefined}
                title={step.done ? undefined : step.description}
                className={cn(
                  "group/step flex items-start gap-2 rounded-md px-1.5 py-1 text-xs leading-4 transition-colors duration-150 hover:bg-sidebar-accent",
                  isNext ? "bg-primary/6 font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-full border text-[0.625rem] tabular-nums",
                    step.done
                      ? "border-surplus bg-surplus-soft text-surplus"
                      : isNext ? "border-primary bg-primary text-primary-foreground" : "border-border",
                  )}
                >
                  {step.done ? <Check className="size-2.5" aria-hidden /> : index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate", step.done && "line-through decoration-muted-foreground/50")}>
                    {step.title}
                  </span>
                  {isNext && (
                    <span className="mt-0.5 block text-[11px] leading-4 font-normal text-muted-foreground">{step.hint}</span>
                  )}
                </span>
                <span className="sr-only">{step.done ? "Done" : isNext ? "Next step" : "Not done yet"}</span>
                {isNext && <ArrowRight className="mt-0.5 size-3 shrink-0 text-primary transition-transform duration-150 group-hover/step:translate-x-0.5" aria-hidden />}
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
