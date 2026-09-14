import { notifyStudyFlowDataChanged } from "@/lib/data-events";
import type { OutcomeResult } from "@/lib/api";
import type { SessionOutcome } from "@/types/session";
import type { ScheduleRevision } from "@/types/schedule";

/** A manual duration is valid only when it represents at least one complete minute. */
export function isPositiveWholeMinute(value: string): boolean {
  const minutes = Number(value);
  return value.trim() !== "" && Number.isFinite(minutes) && Number.isInteger(minutes) && minutes > 0;
}

export function outcomeSuccessCopy(
  outcome: SessionOutcome,
  revision: ScheduleRevision | null,
): string {
  if (outcome === "Completed") return "Session recorded as finished";
  return revision
    ? "Recorded — StudyFlow has a new plan for you to review"
    : "Session progress recorded";
}

export function applyRecordedOutcome(
  result: OutcomeResult,
  effects: {
    setProposal: (revision: ScheduleRevision) => void;
    setPreviewOpen: (open: boolean) => void;
    notify?: () => void;
  },
): void {
  if (result.revision) {
    effects.setProposal(result.revision);
    effects.setPreviewOpen(true);
  }
  (effects.notify ?? notifyStudyFlowDataChanged)();
}
