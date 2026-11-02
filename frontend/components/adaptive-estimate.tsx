"use client";

import * as React from "react";
import { Sparkles } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDuration, CATEGORY_CONFIG } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { scheduling } from "@/lib/api";
import type { AdaptiveEstimate } from "@/types/progress";

/**
 * How the student's own history changes an estimate (SPEC §15.6).
 *
 * Shows the original, the adaptive value, its likely range, and which of the
 * two will actually be scheduled. The explanation stays in tasks and minutes,
 * never in model terms such as error or bias.
 */
export function AdaptiveEstimateNote({
  estimate,
  onChoose,
}: {
  estimate: AdaptiveEstimate;
  /** Lets the student schedule with the original instead (SPEC §15.1). */
  onChoose?: (which: "original" | "adaptive") => void;
}) {
  const usingAdaptive = estimate.plannedDuration === estimate.adaptiveEstimate;
  const longer = estimate.adaptiveEstimate > estimate.originalEstimate;
  const category = CATEGORY_CONFIG[estimate.category].label.toLowerCase();
  const range = describeEstimateRange(estimate);
  const basis = describeEstimateBasis(estimate);

  return (
    <Callout
      tone="info"
      icon={Sparkles}
      title={
        longer
          ? "You usually need longer than you plan for these"
          : "You usually finish these faster than you plan"
      }
    >
      <p>
        Based on your earlier finished{" "}
        {estimate.isCategorySpecific ? `${category} tasks` : "tasks"}, your actual time has
        run {longer ? "over" : "under"} your estimate. StudyFlow suggests{" "}
        <strong className="font-medium text-foreground">
          {formatDuration(estimate.adaptiveEstimate)}
        </strong>{" "}
        instead of {formatDuration(estimate.originalEstimate)}.
      </p>

      {(range || basis) && (
        <p className="mt-2 text-xs">
          {range && <span className="tabular-nums text-foreground">{range}</span>}
          {range && basis && <br />}
          {basis}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Choice
          label={`Your estimate · ${formatDuration(estimate.originalEstimate)}`}
          active={!usingAdaptive}
          onClick={onChoose && (() => onChoose("original"))}
        />
        <Choice
          label={`Suggested · ${formatDuration(estimate.adaptiveEstimate)}`}
          active={usingAdaptive}
          onClick={onChoose && (() => onChoose("adaptive"))}
        />
      </div>

      <p className="mt-2 text-xs">
        Scheduling with{" "}
        <strong className="font-medium text-foreground">
          {formatDuration(estimate.plannedDuration)}
        </strong>
        .
      </p>
    </Callout>
  );
}

/** "About 1h 26m · likely 1h 15m–1h 50m", or null without a usable range. */
export function describeEstimateRange(estimate: AdaptiveEstimate): string | null {
  const range = estimate.range;
  if (!range || range.high <= range.low) return null;
  return `About ${formatDuration(estimate.adaptiveEstimate)} · likely ${formatDuration(range.low)}–${formatDuration(range.high)}`;
}

/**
 * Which of the student's own tasks the suggestion leans on, in plain words.
 * SPEC §15.6 rules out sample counts in the interface, so it names the kind
 * of history and never how many tasks are in it.
 */
export function describeEstimateBasis(estimate: AdaptiveEstimate): string | null {
  const basis = estimate.basis;
  if (!basis) return null;
  const source =
    basis.scope === "category"
      ? `Mostly based on your earlier ${CATEGORY_CONFIG[estimate.category].label} tasks`
      : basis.scope === "size"
        ? "Mostly based on your earlier tasks of a similar size"
        : "Based on all your earlier tasks";
  const inProgress = basis.provisionalRecords > 0 ? ", including some still in progress" : "";
  return `${source}${inProgress}.`;
}

/**
 * Explains the immutable estimate snapshot saved with a task. Unlike a live
 * preview, it deliberately avoids history counts and other model diagnostics.
 */
export function PersistedEstimateNote({
  originalEstimate,
  adaptiveEstimate,
  plannedDuration,
  plannedSource,
}: {
  originalEstimate: number;
  adaptiveEstimate: number;
  plannedDuration: number;
  plannedSource: "Original" | "Adaptive";
}) {
  const usingAdaptive = plannedSource === "Adaptive";

  return (
    <Callout tone="info" icon={Sparkles} title="Your saved task plan">
      <p>
        Your estimate was <strong className="font-medium text-foreground">{formatDuration(originalEstimate)}</strong>.
        {" "}StudyFlow suggested <strong className="font-medium text-foreground">{formatDuration(adaptiveEstimate)}</strong>,
        {" "}and you chose to schedule with {usingAdaptive ? "the suggestion" : "your estimate"}.
      </p>
      <p className="mt-2 text-xs">
        Planned duration: <strong className="font-medium text-foreground">{formatDuration(plannedDuration)}</strong>.
      </p>
    </Callout>
  );
}

function Choice({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick?: () => void;
}) {
  if (!onClick) {
    return (
      <span
        className={cn(
          "rounded-md border px-2.5 py-1 text-xs",
          active ? "border-primary bg-primary/10 font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
    );
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-md px-2.5 font-normal",
        active
          ? "border-primary bg-primary/10 font-medium text-foreground hover:bg-primary/10"
          : "text-muted-foreground",
      )}
    >
      {label}
    </Button>
  );
}

/**
 * The one-off acknowledgment SPEC §15.4 requires the first time a category
 * produces an estimate above 2× or below 0.5× the student's own.
 *
 * It asks which value to schedule with rather than announcing a decision, and
 * the uncapped adaptive value is preserved either way. Once acknowledged, the
 * explanation keeps showing but stops blocking task creation for that category.
 */
export function LargeAdjustmentDialog({
  estimate,
  open,
  onOpenChange,
  onDecided,
}: {
  estimate: AdaptiveEstimate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDecided: (which: "original" | "adaptive") => void;
}) {
  const [busy, setBusy] = React.useState(false);
  if (!estimate) return null;

  const category = CATEGORY_CONFIG[estimate.category].label.toLowerCase();
  const longer = estimate.adaptiveEstimate > estimate.originalEstimate;
  const multiple = estimate.factor >= 1
    ? `${estimate.factor.toFixed(1)}×`
    : `${Math.round(estimate.factor * 100)}%`;

  async function decide(which: "original" | "adaptive") {
    setBusy(true);
    try {
      await scheduling.acknowledgeAdjustment(estimate!.category);
      onDecided(which);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {longer
              ? `Your ${category} work usually takes much longer`
              : `Your ${category} work usually takes much less time`}
          </DialogTitle>
          <DialogDescription>
            This is the first time StudyFlow has suggested a big change for this kind of
            task, so it is asking before using it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Based on your earlier finished{" "}
            {estimate.isCategorySpecific ? `${category} tasks` : "tasks"}, you have taken about{" "}
            <strong className="font-medium text-foreground">{multiple}</strong> your own
            estimate. For this task that means{" "}
            <strong className="font-medium text-foreground">
              {formatDuration(estimate.adaptiveEstimate)}
            </strong>{" "}
            rather than {formatDuration(estimate.originalEstimate)}.
          </p>

          <div className="grid gap-2 sm:grid-cols-2">
            <Option
              title="Use your estimate"
              value={formatDuration(estimate.originalEstimate)}
              hint="Schedule exactly what you entered."
            />
            <Option
              title="Use the suggestion"
              value={formatDuration(estimate.adaptiveEstimate)}
              hint="Based on how these actually go for you."
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => void decide("original")}
            disabled={busy}
          >
            Keep {formatDuration(estimate.originalEstimate)}
          </Button>
          <Button onClick={() => void decide("adaptive")} disabled={busy}>
            Use {formatDuration(estimate.adaptiveEstimate)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Option({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <p className="mt-1 text-2xl leading-none tabular-nums font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
