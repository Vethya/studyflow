"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowLeft, ArrowRight, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/use-session";
import {
  onProductTourRequest,
  productTourSeen,
  rememberProductTourSeen,
  subscribeToOnboardingFlags,
} from "@/lib/onboarding";
import { cn } from "@/lib/utils";

export interface TourStep {
  id: string;
  /** The `data-tour` value of the element to highlight. Without one, the card sits in the middle. */
  target?: string;
  title: string;
  body: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to StudyFlow",
    body: "StudyFlow answers one question: does your coursework fit the time you have? This tour shows you where everything is. It takes about a minute.",
  },
  {
    id: "dashboard",
    target: "nav-dashboard",
    title: "Dashboard",
    body: "Your day at a glance: what is left to study today, what is due this week, and whether your work still fits your free time.",
  },
  {
    id: "tasks",
    target: "nav-tasks",
    title: "Tasks",
    body: "Every assignment, reading, exam and project. Give each one a due date and a rough guess of how long it will take.",
  },
  {
    id: "calendar",
    target: "nav-calendar",
    title: "Calendar",
    body: "Your study plan. Press Plan my time and StudyFlow books study sessions in your free hours, before each deadline.",
  },
  {
    id: "availability",
    target: "nav-availability",
    title: "Availability",
    body: "The hours you can study each week, plus one-off times when you are busy. StudyFlow only plans inside these hours.",
  },
  {
    id: "progress",
    target: "nav-progress",
    title: "Progress",
    body: "How much you have studied compared with your estimates, and how each session went.",
  },
  {
    id: "settings",
    target: "nav-settings",
    title: "Settings",
    body: "Your profile, time zone, how long study sessions and breaks are, your password and Google connections.",
  },
  {
    id: "guide",
    target: "getting-started",
    title: "Getting started",
    body: "Four steps to your first study plan. Each step ticks itself off when you do it. If you hide this list, bring it back from the account menu.",
  },
  {
    id: "search",
    target: "search",
    title: "Search",
    body: "Find any task or page, or run an action, from anywhere. The keyboard shortcut is shown on the button.",
  },
  {
    id: "add-task",
    target: "add-task",
    title: "Add a task",
    body: "Add a new task from any page. Press N to do it without the mouse.",
  },
  {
    id: "reminders",
    target: "reminders",
    title: "Study reminders",
    body: "A red dot appears here when a new plan needs your review, a session needs an outcome, or a task is overdue.",
  },
  {
    id: "account",
    target: "account",
    title: "Your account",
    body: "Settings, keyboard shortcuts, light or dark mode, and sign out. You can take this tour again from here at any time.",
  },
  {
    id: "done",
    title: "You are ready",
    body: "Start by setting the hours you can study each week. Everything else in StudyFlow builds on them.",
  },
];

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const GAP = 14;
const MARGIN = 16;
/** Room left around the highlighted element so its edges stay visible. */
const SPOT_PADDING = 6;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));

/**
 * Puts the card beside the highlighted element. Things in the left-hand
 * sidebar get it to their right; things in the header get it below.
 */
export function placeCard(
  target: Box,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
): { top: number; left: number } {
  const right = target.left + target.width;
  const bottom = target.top + target.height;
  const centredTop = clamp(target.top + target.height / 2 - card.height / 2, MARGIN, viewport.height - MARGIN - card.height);
  const centredLeft = clamp(target.left + target.width / 2 - card.width / 2, MARGIN, viewport.width - MARGIN - card.width);

  const fitsRight = right + GAP + card.width <= viewport.width - MARGIN;
  const fitsBelow = bottom + GAP + card.height <= viewport.height - MARGIN;
  const inLeftThird = right < viewport.width / 3;

  if (inLeftThird && fitsRight) return { top: centredTop, left: right + GAP };
  if (fitsBelow) return { top: bottom + GAP, left: centredLeft };
  if (fitsRight) return { top: centredTop, left: right + GAP };
  return { top: Math.max(MARGIN, target.top - GAP - card.height), left: centredLeft };
}

function findTarget(target: string | undefined): HTMLElement | null {
  if (!target) return null;
  const element = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
  if (!element) return null;
  const box = element.getBoundingClientRect();
  // Collapsed or closed (e.g. the phone's navigation drawer): nothing to point at.
  return box.width > 0 && box.height > 0 ? element : null;
}

/**
 * A first-visit walkthrough: dims the app, highlights one control at a time
 * and says what it is for. Opens by itself once per account, and again
 * whenever the account menu asks for it.
 */
export function ProductTour() {
  const accountId = useSession().account?.id ?? null;
  // `true` on the server, so the tour never flashes in before the browser's
  // own answer arrives. A signed-out render also stays closed.
  const seen = useSyncExternalStore(
    subscribeToOnboardingFlags,
    () => productTourSeen(accountId),
    () => true,
  );
  const [replaying, setReplaying] = useState(false);
  const [index, setIndex] = useState(0);
  const [spot, setSpot] = useState<Box | null>(null);
  const [cardPosition, setCardPosition] = useState<{ top: number; left: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const bodyId = useId();

  const open = !seen || replaying;
  const step = TOUR_STEPS[index];
  const last = index === TOUR_STEPS.length - 1;

  useEffect(
    () =>
      onProductTourRequest(() => {
        setIndex(0);
        setReplaying(true);
      }),
    [],
  );

  const finish = useCallback(() => {
    rememberProductTourSeen(accountId);
    setReplaying(false);
    setIndex(0);
  }, [accountId]);
  const next = useCallback(() => setIndex((current) => Math.min(current + 1, TOUR_STEPS.length - 1)), []);
  const back = useCallback(() => setIndex((current) => Math.max(current - 1, 0)), []);

  useLayoutEffect(() => {
    if (!open) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const element = findTarget(step.target);
        if (!element) {
          setSpot(null);
          setCardPosition(null);
          return;
        }
        // The card is in the DOM whenever the tour is open, before this frame runs.
        const card = cardRef.current as HTMLDivElement;
        const box = element.getBoundingClientRect();
        const padded = {
          top: box.top - SPOT_PADDING,
          left: box.left - SPOT_PADDING,
          width: box.width + SPOT_PADDING * 2,
          height: box.height + SPOT_PADDING * 2,
        };
        setSpot(padded);
        setCardPosition(
          placeCard(padded, { width: card.offsetWidth, height: card.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }),
        );
      });
    };
    findTarget(step.target)?.scrollIntoView?.({ block: "nearest" });
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, step.target]);

  useEffect(() => {
    if (open) (primaryRef.current as HTMLElement).focus();
  }, [open, index]);

  useEffect(() => {
    if (!open) return;
    // Capture phase, so the app's single-key shortcuts (N, ?) cannot fire
    // behind the tour while it is open.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        next();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        back();
      } else if (event.key === "Tab") {
        const focusable = Array.from((cardRef.current as HTMLDivElement).querySelectorAll<HTMLElement>("a[href], button"));
        const first = focusable[0];
        const final = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          final.focus();
        } else if (!event.shiftKey && document.activeElement === final) {
          event.preventDefault();
          first.focus();
        }
      } else if (event.key.length === 1 && event.key !== " ") {
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, finish, next, back]);

  if (!open) return null;

  const placed = spot !== null && cardPosition !== null;

  return createPortal(
    <div className="study-shell fixed inset-0 z-100">
      {/* Blocks the app underneath; the tour is the only thing to act on. */}
      <div aria-hidden className={cn("absolute inset-0", !placed && "bg-black/55")} />
      {placed && (
        <div
          aria-hidden
          data-testid="tour-spotlight"
          className="pointer-events-none absolute rounded-xl ring-2 ring-primary transition-[top,left,width,height] duration-300 ease-out motion-reduce:transition-none"
          style={{ ...spot, boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.55)" }}
        />
      )}
      <div
        className={cn("absolute", !placed && "inset-0 flex items-center justify-center p-4")}
        style={placed ? cardPosition : undefined}
      >
        <div
          ref={cardRef}
          key={step.id}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={bodyId}
          className="rise-in w-[min(22rem,calc(100vw-2rem))] rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium tabular-nums text-muted-foreground">
              Step {index + 1} of {TOUR_STEPS.length}
            </p>
            <Button variant="ghost" size="icon-xs" aria-label="Skip tour" title="Skip tour" onClick={finish} className="text-muted-foreground hover:text-foreground">
              <X aria-hidden />
            </Button>
          </div>
          <div aria-hidden className="mt-2 h-1 overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none"
              style={{ width: `${((index + 1) / TOUR_STEPS.length) * 100}%` }}
            />
          </div>
          <h2 id={titleId} className="mt-3 text-base font-semibold tracking-tight">
            {step.title}
          </h2>
          <p id={bodyId} className="mt-1 text-sm leading-relaxed text-pretty text-muted-foreground">
            {step.body}
          </p>
          {/* Wraps rather than overflows when the main button's label is long. */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            {index === 0 ? (
              <Button variant="ghost" size="sm" onClick={finish}>
                Skip
              </Button>
            ) : last ? (
              <Button variant="ghost" size="sm" onClick={finish}>
                Finish
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={back}>
                <ArrowLeft aria-hidden /> Back
              </Button>
            )}
            {last ? (
              <Button
                ref={primaryRef as React.Ref<HTMLButtonElement>}
                size="sm"
                nativeButton={false}
                render={<Link href="/availability" />}
                onClick={finish}
              >
                Set my study hours
              </Button>
            ) : (
              <Button ref={primaryRef as React.Ref<HTMLButtonElement>} size="sm" onClick={next}>
                {index === 0 ? "Start the tour" : "Next"} <ArrowRight aria-hidden />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
