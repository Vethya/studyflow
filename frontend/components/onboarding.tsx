"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { CalendarClock, CalendarDays, Check, ClipboardList, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  gettingStartedHidden,
  isNewAccount,
  onboardingProgress,
  onboardingSteps,
  rememberGettingStartedHidden,
  rememberWelcomeSeen,
  subscribeToOnboardingFlags,
  welcomeSeen,
  type OnboardingState,
  type OnboardingStepId,
} from "@/lib/onboarding";

const STEP_ICONS: Record<OnboardingStepId, React.ElementType> = {
  hours: CalendarDays,
  tasks: ClipboardList,
  plan: Sparkles,
  outcomes: CalendarClock,
};

/**
 * What StudyFlow does, in the order a student does it. Shown once, only to an
 * account with no hours and no tasks, and never again after it is closed.
 */
export function WelcomeTour({ state, ready }: { state: OnboardingState; ready: boolean }) {
  // `true` on the server, so the tour never flashes before the browser's own
  // answer arrives.
  const seen = useSyncExternalStore(
    subscribeToOnboardingFlags,
    welcomeSeen,
    () => true,
  );
  const [step, setStep] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [prevSeen, setPrevSeen] = useState(seen);

  if (prevSeen !== seen) {
    setPrevSeen(seen);
    if (!seen) {
      setDismissed(false);
      setStep(0);
    }
  }

  const open = !dismissed && ready && !seen && isNewAccount(state);
  const steps = onboardingSteps(state);
  const current = steps[step];
  const Icon = STEP_ICONS[current.id];
  const isLast = step === steps.length - 1;

  function close() {
    setDismissed(true);
    rememberWelcomeSeen();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogDescription>
            Step {step + 1} of {steps.length}
          </DialogDescription>
          <DialogTitle className="flex items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50">
              <Icon className="size-4" aria-hidden />
            </span>
            {current.title}
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm leading-6 text-muted-foreground">{current.description}</p>

        {/* One dot per step, so the tour says how long it is before it starts. */}
        <div className="flex gap-1.5" aria-hidden>
          {steps.map((item, index) => (
            <span
              key={item.id}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                index <= step ? "bg-foreground" : "bg-muted",
              )}
            />
          ))}
        </div>

        <DialogFooter className="sm:justify-between">
          <DialogClose render={<Button variant="ghost" />} onClick={close}>
            {isLast ? "Close" : "Skip"}
          </DialogClose>
          <div className="flex gap-2">
            {step > 0 && (
              <Button variant="outline" onClick={() => setStep(step - 1)}>
                Back
              </Button>
            )}
            {isLast ? (
              <Button nativeButton={false} render={<Link href={steps[0].href} />} onClick={close}>
                {steps[0].action}
              </Button>
            ) : (
              <Button onClick={() => setStep(step + 1)}>Next</Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The same four steps as a checklist that ticks itself off from real data.
 * It disappears for good once every step is done, or when dismissed.
 */
export function GettingStarted({ state, ready }: { state: OnboardingState; ready: boolean }) {
  const hidden = useSyncExternalStore(
    subscribeToOnboardingFlags,
    gettingStartedHidden,
    () => true,
  );

  const steps = onboardingSteps(state);
  const progress = onboardingProgress(steps);

  if (!ready || hidden || progress.complete) return null;

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Getting started</CardTitle>
        <CardDescription>
          {progress.done} of {progress.total} done. Each step makes the plan a bit more yours.
        </CardDescription>
        <CardAction>
          <Button
            variant="ghost"
            size="sm"
            onClick={rememberGettingStartedHidden}
          >
            Hide
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="p-0">
        <ol className="divide-y">
          {steps.map((item, index) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 px-(--card-spacing) py-3"
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums",
                  item.done
                    ? "border-surplus bg-surplus-soft text-surplus"
                    : "text-muted-foreground",
                )}
              >
                {item.done ? <Check className="size-3.5" aria-hidden /> : index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block text-sm font-medium",
                    item.done && "text-muted-foreground line-through",
                  )}
                >
                  {item.title}
                </span>
                {!item.done && (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {item.description}
                  </span>
                )}
              </span>
              <span className="sr-only">{item.done ? "Done" : "Not done yet"}</span>
              {!item.done && (
                <Button
                  size="sm"
                  variant={item.id === progress.next?.id ? "default" : "outline"}
                  nativeButton={false}
                  render={<Link href={item.href} />}
                >
                  {item.action}
                </Button>
              )}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
