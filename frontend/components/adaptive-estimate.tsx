"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";
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
 * Shows the original, the adaptive value, and which of the two will actually
 * be scheduled. It deliberately shows no accuracy figures — SPEC §15.6 forbids
 * exposing MAE, signed bias, prediction errors or sample counts to the
 * student, so the explanation is in tasks and minutes, never in model terms.
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
        Across {estimate.basedOnTasks} finished{" "}
        {estimate.isCategorySpecific ? `${category} tasks` : "tasks"}, your actual time has
        run {longer ? "over" : "under"} your estimate. StudyFlow suggests{" "}
        <strong className="font-medium text-foreground">
          {formatDuration(estimate.adaptiveEstimate)}
        </strong>{" "}
        instead of {formatDuration(estimate.originalEstimate)}.
      </p>

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
          active ? "border-foreground bg-muted font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-md border px-2.5 py-1 text-xs transition-colors",
        active
          ? "border-foreground bg-muted font-medium text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      {label}
    </button>
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
            Across {estimate.basedOnTasks} finished {category} tasks, you have taken about{" "}
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
      <p className="mt-1 font-display text-xl font-bold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
