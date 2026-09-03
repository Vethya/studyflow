import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiJson } from "./client";
import { listTasks } from "./tasks";
import { recordOutcome } from "./scheduling";

vi.mock("./client", () => ({
  ApiError: class ApiError extends Error {
    status = 500;
  },
  apiJson: vi.fn(),
  apiVoid: vi.fn(),
  buildQuery: vi.fn(() => ""),
}));

vi.mock("./tasks", () => ({ listTasks: vi.fn() }));

const session = {
  id: "session-1",
  task_id: "task-1",
  starts_at: "2026-09-03T09:00:00Z",
  ends_at: "2026-09-03T10:00:00Z",
  planned_duration_minutes: 60,
  outcome: {
    session_id: "session-1",
    kind: "delayed" as const,
    actual_minutes: 30,
    remaining_minutes: 45,
    recorded_at: "2026-09-03T10:00:00Z",
    rescheduled_at: null,
  },
};

const revision = {
  id: "revision-1",
  kind: "revision" as const,
  revision_reason: "Some work remains.",
  status: "feasible" as const,
  created_at: "2026-09-03T10:00:00Z",
  sessions: [],
  task_allocations: [],
  unscheduled_work: [],
  overload_warning: null,
  scenario: null,
};

describe("recordOutcome", () => {
  beforeEach(() => {
    vi.mocked(listTasks).mockResolvedValue([
      {
        id: "task-1",
        title: "Calculus",
      },
    ] as never);
  });

  it("maps the response session and revision returned by the endpoint", async () => {
    vi.mocked(apiJson).mockResolvedValue({ session, outcome: session.outcome, revision });

    await expect(
      recordOutcome("session-1", {
        outcome: "Delayed",
        actualMinutes: 30,
        revisedRemainingMinutes: 45,
      }),
    ).resolves.toMatchObject({
      session: { taskTitle: "Calculus", outcome: "Delayed", actualDuration: 30 },
      revision: { id: "revision-1", reason: "Some work remains." },
    });
  });

  it("maps a nullable response revision to null", async () => {
    vi.mocked(apiJson).mockResolvedValue({ session, outcome: session.outcome, revision: null });

    await expect(
      recordOutcome("session-1", { outcome: "Completed", actualMinutes: 60 }),
    ).resolves.toMatchObject({
      session: { taskTitle: "Calculus", outcome: "Delayed" },
      revision: null,
    });
  });
});
