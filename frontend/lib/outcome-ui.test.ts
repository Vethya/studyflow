import { describe, expect, it, vi } from "vitest";
import type { OutcomeResult } from "@/lib/api";
import {
  applyRecordedOutcome,
  isPositiveWholeMinute,
  outcomeSuccessCopy,
} from "./outcome-ui";

const revision = {
  id: "revision-1",
  reason: "Some work remains.",
  proposedSessions: [],
  unscheduledWork: [],
  overloadWarnings: [],
  createdAt: "2026-09-03T09:00:00Z",
};

const result = (withRevision: boolean): OutcomeResult => ({
  session: {
    id: "session-1",
    taskId: "task-1",
    taskTitle: "Calculus",
    category: "Other",
    startTime: "2026-09-03T09:00:00Z",
    endTime: "2026-09-03T10:00:00Z",
    plannedDuration: 60,
    isAwaitingOutcome: false,
  },
  revision: withRevision ? revision : null,
});

describe("isPositiveWholeMinute", () => {
  it.each(["1.5", "0.5", "-1.5"])("rejects fractional minute entry %s", (value) => {
    expect(isPositiveWholeMinute(value)).toBe(false);
  });

  it.each(["1", "60", " 15 "])("accepts positive whole minute entry %s", (value) => {
    expect(isPositiveWholeMinute(value)).toBe(true);
  });
});

describe("outcomeSuccessCopy", () => {
  it("uses the completed copy for Completed outcomes", () => {
    expect(outcomeSuccessCopy("Completed", revision)).toBe("Session recorded as finished");
  });

  it("uses the review copy when a revision exists", () => {
    expect(outcomeSuccessCopy("Delayed", revision)).toBe(
      "Recorded — StudyFlow has a new plan for you to review",
    );
  });

  it("uses progress copy for a nullable revision without inventing one", () => {
    expect(outcomeSuccessCopy("Delayed", null)).toBe("Session progress recorded");
  });
});

describe("applyRecordedOutcome", () => {
  it.each([
    ["task detail", true],
    ["dashboard", false],
    ["calendar", true],
  ])("broadcasts exactly once after the successful %s callback", (_page, withRevision) => {
    const setProposal = vi.fn();
    const setPreviewOpen = vi.fn();
    const notify = vi.fn();

    applyRecordedOutcome(result(withRevision), { setProposal, setPreviewOpen, notify });

    if (withRevision) {
      expect(setProposal).toHaveBeenCalledExactlyOnceWith(revision);
      expect(setPreviewOpen).toHaveBeenCalledExactlyOnceWith(true);
    } else {
      expect(setProposal).not.toHaveBeenCalled();
      expect(setPreviewOpen).not.toHaveBeenCalled();
    }
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
