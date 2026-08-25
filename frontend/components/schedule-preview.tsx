"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarClock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { DetailDrawer } from "@/components/detail-drawer";
import { UnscheduledWorkList } from "@/components/unscheduled-work-list";
import { formatDuration } from "@/lib/constants";
import { formatClock } from "@/lib/datetime";
import { scheduling } from "@/lib/api";
import { describeError } from "@/hooks/use-api";
import { DAY_NAMES_SHORT } from "@/lib/constants";
import type { ScheduleProposal } from "@/types/schedule";
import type { StudySession } from "@/types/session";

/**
 * Preview and accept-or-reject a proposed plan (SPEC §11.2, §14.2).
 *
 * Acceptance is all-or-nothing by design, not by omission: partial acceptance
 * can invalidate the feasibility guarantees the scheduler just proved
 * (SPEC §14.3). The buttons say so plainly rather than offering per-session
 * controls that would have to be taken away again.
 */
export function SchedulePreview({
  proposal,
  open,
  onOpenChange,
  onAccepted,
  onRejected,
}: {
  proposal: ScheduleProposal | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccepted: () => void;
  onRejected: () => void;
}) {
  const [busy, setBusy] = React.useState<"accept" | "reject" | null>(null);

  if (!proposal) return null;

  const upcoming = proposal.proposedSessions
    .filter((session) => !session.outcome && new Date(session.endTime) > new Date())
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  const totalMinutes = upcoming.reduce((sum, session) => sum + session.plannedDuration, 0);

  async function run(action: "accept" | "reject") {
    setBusy(action);
    try {
      if (action === "accept") {
        await scheduling.acceptProposal(proposal!.id);
        toast.success("Plan accepted");
        onAccepted();
      } else {
        await scheduling.rejectProposal(proposal!.id);
        toast.success("Plan discarded — nothing changed");
        onRejected();
      }
      onOpenChange(false);
    } catch (cause) {
      toast.error(describeError(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <DetailDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={proposal.reason ? "A new plan for you" : "Your proposed plan"}
      description={
        proposal.reason
          ? undefined
          : `${upcoming.length} sessions · ${formatDuration(totalMinutes)} of study`
      }
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => void run("reject")}
            disabled={busy !== null}
          >
            {busy === "reject" && <Loader2 className="animate-spin" />}
            Discard
          </Button>
          <Button onClick={() => void run("accept")} disabled={busy !== null}>
            {busy === "accept" && <Loader2 className="animate-spin" />}
            Use this plan
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* SPEC §14.2: a revision must say why it was generated. */}
        {proposal.reason && (
          <Callout tone="info" title="Why this changed">
            {proposal.reason}
          </Callout>
        )}

        {proposal.overloadWarnings.length > 0 && (
          <Callout
            tone="warning"
            title={`${proposal.overloadWarnings.length} ${
              proposal.overloadWarnings.length === 1 ? "task still doesn’t" : "tasks still don’t"
            } fit`}
          >
            Using this plan is still an improvement, but you will need to move a deadline or
            add study time to fit everything.
          </Callout>
        )}

        {proposal.unscheduledWork.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-medium">Work with no slot</h3>
            <UnscheduledWorkList items={proposal.unscheduledWork} />
          </section>
        )}

        <section>
          <h3 className="mb-2 text-sm font-medium">
            {upcoming.length === 0 ? "No sessions" : "Sessions"}
          </h3>
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              StudyFlow could not place any sessions. Add study time or move a deadline, then
              try again.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {upcoming.map((session) => (
                <SessionRow key={session.id} session={session} />
              ))}
            </ul>
          )}
        </section>

        <p className="text-xs text-muted-foreground">
          Using this plan replaces all of your upcoming sessions. Sessions you have already
          recorded stay exactly as they are.
        </p>
      </div>
    </DetailDrawer>
  );
}

function SessionRow({ session }: { session: StudySession }) {
  const start = new Date(session.startTime);
  return (
    <li className="flex items-baseline gap-3 px-3 py-2">
      <span className="w-24 shrink-0 text-xs tabular-nums text-muted-foreground">
        {DAY_NAMES_SHORT[start.getDay()]} {start.getDate()} · {formatClock(start)}
      </span>
      <Link
        href={`/tasks/${session.taskId}`}
        className="min-w-0 flex-1 truncate text-sm underline-offset-4 hover:underline"
      >
        {session.taskTitle}
      </Link>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {formatDuration(session.plannedDuration)}
      </span>
    </li>
  );
}

/** The banner that surfaces a pending plan from anywhere in the app. */
export function PendingPlanBanner({
  proposal,
  onReview,
}: {
  proposal: ScheduleProposal;
  onReview: () => void;
}) {
  return (
    <Callout
      tone="warning"
      icon={CalendarClock}
      title={proposal.reason ? "Your plan needs updating" : "A new plan is ready"}
      actions={
        <Button size="sm" onClick={onReview}>
          Review it
        </Button>
      }
    >
      {proposal.reason ??
        "StudyFlow worked out a schedule for your open work. Nothing changes until you accept it."}
    </Callout>
  );
}
