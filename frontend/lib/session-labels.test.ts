import { expect, it } from "vitest";
import { labelSessions, MISSING_SESSION_TITLE, UNKNOWN_SESSION_TITLE } from "./session-labels";
import type { StudySession } from "@/types/session";

const session = (overrides: Partial<StudySession> = {}): StudySession => ({
  id: "session-1",
  taskId: "task-1",
  taskTitle: MISSING_SESSION_TITLE,
  category: "Other",
  startTime: "2026-10-01T09:00:00Z",
  endTime: "2026-10-01T10:00:00Z",
  plannedDuration: 60,
  isAwaitingOutcome: false,
  ...overrides,
});

it("keeps API titles and waits while the task list is still loading", () => {
  const labelled = session({ taskTitle: "Essay draft", category: "Research/Writing" });
  const loading = [labelled];
  expect(labelSessions(loading, null)).toBe(loading);
  expect(labelSessions(loading, undefined)).toBe(loading);
  const titled = labelSessions([labelled], [{ id: "task-1", title: "Other title", category: "Reading" }]);
  expect(titled[0]).toBe(labelled);
});

it("fills a missing title and category from the loaded task", () => {
  const [labelled] = labelSessions(
    [session()],
    [{ id: "task-1", title: "Read chapter", category: "Reading" }],
  );
  expect(labelled).toMatchObject({ taskTitle: "Read chapter", category: "Reading" });
});

it("says the task is unknown when the loaded list does not contain it", () => {
  const [labelled] = labelSessions([session({ taskId: "gone" })], []);
  expect(labelled.taskTitle).toBe(UNKNOWN_SESSION_TITLE);
  expect(labelled.category).toBe("Other");
});
