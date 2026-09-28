import { afterEach, expect, it, vi } from "vitest";
import {
  acceptProposal,
  acknowledgeAdjustment,
  generateProposal,
  getAdaptiveEstimate,
  getActiveSchedule,
  getSession,
  getPendingRevision,
  listSessions,
  recordOutcome,
  rejectProposal,
  ScheduleTechnicalFailure,
  simulatePlan,
} from "./scheduling";
import type { WireScheduleProposal } from "./wire";
import type { OutcomeFormData } from "@/types/session";
import type { AcademicTask } from "@/types/task";

afterEach(() => vi.unstubAllGlobals());

const proposal: WireScheduleProposal = {
  id: "proposal-1",
  kind: "generation",
  revision_reason: null,
  status: "overload",
  created_at: "2026-09-01T12:00:00Z",
  sessions: [
    {
      id: "proposed-session-1",
      task_id: "task-1",
      task_title: "Read chapter",
      starts_at: "2026-10-01T18:00:00+07:00",
      ends_at: "2026-10-01T19:00:00+07:00",
      planned_duration_minutes: 60,
    },
  ],
  task_allocations: [
    {
      task_id: "task-1",
      task_title: "Read chapter",
      deadline_at: "2026-10-02T12:00:00+07:00",
      required_minutes: 90,
      scheduled_minutes: 60,
      unscheduled_minutes: 30,
      raw_calendar_capacity_minutes: 60,
      available_minutes_before_deadline: 60,
      shortfall_minutes: 30,
    },
  ],
  unscheduled_work: [
    {
      task_id: "task-1",
      task_title: "Read chapter",
      required_minutes: 90,
      available_minutes_before_deadline: 60,
      shortfall_minutes: 30,
      unscheduled_minutes: 30,
    },
  ],
  overload_warning: {
    affected_tasks: [],
    relevant_unavailable_periods: [
      {
        id: "blocked-1",
        starts_at: "2026-10-01T20:00:00+07:00",
        ends_at: "2026-10-01T21:00:00+07:00",
        reason: "Appointment",
      },
    ],
    remedies: ["extend_deadline"],
  },
  scenario: {
    temporary_availability: [],
    temporary_blocked_periods: [],
    deadline_overrides: [],
  },
};

const session = {
  id: "session-1",
  task_id: "task-1",
  starts_at: "2026-09-01T18:00:00+07:00",
  ends_at: "2026-09-01T19:00:00+07:00",
  planned_duration_minutes: 60,
  outcome: {
    session_id: "session-1",
    kind: "delayed" as const,
    actual_minutes: 40,
    remaining_minutes: 20,
    recorded_at: "2026-09-01T20:00:00Z",
    rescheduled_at: null,
  },
};

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init: RequestInit = {}) =>
    handler(String(input), init),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

it("sends scenario overrides and preserves overload explanations", async () => {
  const fetchMock = stubFetch(() => Response.json(proposal));
  const scenario = {
    temporary_availability: [],
    temporary_blocked_periods: [],
    deadline_overrides: [],
  };

  await expect(generateProposal(scenario)).resolves.toMatchObject({
    id: "proposal-1",
    proposedSessions: [{ id: "proposed-session-1", taskTitle: "Read chapter" }],
    unscheduledWork: [{ taskId: "task-1", remainingMinutes: 30 }],
    overloadWarnings: [
      {
        taskId: "task-1",
        shortfallMinutes: 30,
        remedies: ["extend_deadline"],
      },
    ],
  });
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/v1/schedule-proposals",
    expect.objectContaining({ method: "POST", body: JSON.stringify({ scenario }) }),
  );
});

it("turns a scheduler 503 into a technical failure without relabelling it overload", async () => {
  stubFetch(() => Response.json({ detail: "Solver timeout" }, { status: 503 }));

  await expect(generateProposal()).rejects.toBeInstanceOf(ScheduleTechnicalFailure);
});

it("uses the default technical-failure message", () => {
  expect(new ScheduleTechnicalFailure().message).toBe("The scheduler could not finish in time.");
});

it("generates a proposal without scenario overrides", async () => {
  const fetchMock = stubFetch(() => Response.json({ ...proposal, status: "ok", overload_warning: null }));

  await generateProposal();

  expect(fetchMock).toHaveBeenCalledWith(
    "/api/v1/schedule-proposals",
    expect.objectContaining({ method: "POST", body: undefined }),
  );
});

it("rethrows non-technical proposal failures", async () => {
  stubFetch(() => Response.json({ detail: "Bad request" }, { status: 400 }));
  await expect(generateProposal()).rejects.toMatchObject({ status: 400 });
});

it("treats a missing pending revision as an empty state", async () => {
  stubFetch(() => Response.json({ detail: "No current proposal" }, { status: 404 }));
  await expect(getPendingRevision()).resolves.toBeNull();
});

it("maps a pending proposal and keeps non-404 errors visible", async () => {
  const fetchMock = stubFetch((url) => {
    if (url.endsWith("/schedule-proposals/current")) {
      return Response.json({ ...proposal, kind: "revision", revision_reason: null });
    }
    return Response.json({ detail: "broken" }, { status: 500 });
  });

  await expect(getPendingRevision()).resolves.toMatchObject({
    id: "proposal-1",
    reason: "Your plan needs updating.",
  });
  fetchMock.mockImplementation(async () => Response.json({ ...proposal, kind: "generation", revision_reason: null }));
  await expect(getPendingRevision()).resolves.toMatchObject({ reason: "" });
  fetchMock.mockImplementation(async () => Response.json({ detail: "broken" }, { status: 500 }));
  await expect(getPendingRevision()).rejects.toMatchObject({ status: 500 });
});

it("simulates a plan with server scenario details or the requested fallback", async () => {
  const requestedScenario = {
    temporary_availability: [{ starts_at: "2026-10-01T09:00:00Z", ends_at: "2026-10-01T10:00:00Z" }],
    temporary_blocked_periods: [],
    deadline_overrides: [],
  };
  const serverScenario = {
    temporary_availability: [{ starts_at: "2026-10-01T09:00:00Z", ends_at: "2026-10-01T10:00:00Z" }],
    temporary_blocked_periods: [
      { starts_at: "2026-10-01T11:00:00Z", ends_at: "2026-10-01T12:00:00Z", reason: "Class" },
      { starts_at: "2026-10-01T13:00:00Z", ends_at: "2026-10-01T14:00:00Z", reason: "" },
    ],
    deadline_overrides: [{ task_id: "task-1", deadline_at: "2026-10-02T12:00:00Z" }],
  };
  const fetchMock = stubFetch((url) => {
    if (url.endsWith("/simulate")) {
      return Response.json({ proposal: { ...proposal, scenario: serverScenario } });
    }
    return Response.json({ proposal: { ...proposal, scenario: null } });
  });

  await expect(simulatePlan(requestedScenario)).resolves.toMatchObject({
    scenario: {
      temporary_availability: [{ starts_at: "2026-10-01T09:00:00Z" }],
      temporary_blocked_periods: [
        { starts_at: "2026-10-01T11:00:00Z", reason: "Class" },
        { starts_at: "2026-10-01T13:00:00Z" },
      ],
      deadline_overrides: [{ task_id: "task-1" }],
    },
    proposal: { id: "proposal-1" },
  });
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/v1/schedule-proposals/simulate",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ scenario: requestedScenario }),
    }),
  );
  fetchMock.mockImplementation(async () => Response.json({ proposal: { ...proposal, scenario: null } }));
  await expect(simulatePlan(requestedScenario)).resolves.toMatchObject({ scenario: requestedScenario });
});

it("turns simulation and pending revision 503 responses into technical failures", async () => {
  stubFetch(() => Response.json({ detail: "Solver timeout" }, { status: 503 }));
  await expect(simulatePlan({ temporary_availability: [], temporary_blocked_periods: [], deadline_overrides: [] }))
    .rejects.toBeInstanceOf(ScheduleTechnicalFailure);

  stubFetch(() => Response.json({ detail: "Bad request" }, { status: 400 }));
  await expect(simulatePlan({ temporary_availability: [], temporary_blocked_periods: [], deadline_overrides: [] }))
    .rejects.toMatchObject({ status: 400 });
});

it("accepts a proposal without refetching when the caller only needs completion", async () => {
  const fetchMock = stubFetch(() => new Response(null, { status: 204 }));

  await expect(acceptProposal("proposal-1", undefined, false)).resolves.toMatchObject({
    id: "active",
    sessions: [],
    isActive: true,
  });
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/v1/schedule-proposals/proposal-1/accept",
    expect.objectContaining({ method: "POST" }),
  );
});

it("lists sessions, gets one session, and wraps the active schedule", async () => {
  const tasks = [{ id: "task-1", title: "Read" }] as unknown as AcademicTask[];
  const fetchMock = stubFetch((url) => {
    if (url.endsWith("/study-sessions")) return Response.json([session]);
    if (url.endsWith("/study-sessions/session-1")) return Response.json(session);
    if (url.endsWith("/tasks")) return Response.json([]);
    if (url.endsWith("/progress")) return Response.json([]);
    return Response.json({ detail: "missing" }, { status: 404 });
  });

  await expect(listSessions(undefined, tasks)).resolves.toMatchObject([
    { id: "session-1", taskTitle: "Read", outcome: "Delayed" },
  ]);
  await expect(getSession("session-1")).resolves.toMatchObject({ id: "session-1", taskTitle: "Untitled task" });
  await expect(getActiveSchedule(undefined, tasks)).resolves.toMatchObject({
    id: "active",
    sessions: [{ id: "session-1" }],
    isActive: true,
  });
  expect(fetchMock).toHaveBeenCalled();
});

it("returns no active schedule when there are no sessions", async () => {
  const tasks = [] as unknown as AcademicTask[];
  stubFetch((url) => url.endsWith("/study-sessions") ? Response.json([]) : Response.json([]));
  await expect(getActiveSchedule(undefined, tasks)).resolves.toBeNull();
});

it("refreshes the active schedule after accepting and can reject a proposal", async () => {
  const fetchMock = stubFetch((url) => {
    if (url.includes("/accept")) return new Response(null, { status: 204 });
    if (url.includes("/reject")) return new Response(null, { status: 204 });
    if (url.endsWith("/study-sessions")) return Response.json([session]);
    return Response.json([]);
  });

  await expect(acceptProposal("proposal-1")).resolves.toMatchObject({
    id: "active",
    sessions: [{ id: "session-1" }],
  });
  await expect(rejectProposal("proposal-1")).resolves.toBeUndefined();
  expect(fetchMock).toHaveBeenLastCalledWith(
    "/api/v1/schedule-proposals/proposal-1/reject",
    expect.objectContaining({ method: "POST" }),
  );
});

it("uses an empty schedule fallback after accepting when no sessions exist", async () => {
  const fetchMock = stubFetch((url) => {
    if (url.includes("/accept")) return new Response(null, { status: 204 });
    return Response.json([]);
  });

  await expect(acceptProposal("proposal-1")).resolves.toMatchObject({
    id: "active",
    sessions: [],
    isActive: true,
  });
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/v1/schedule-proposals/proposal-1/accept",
    expect.objectContaining({ method: "POST" }),
  );
});

it("records an outcome and maps the returned session and recovery revision", async () => {
  const fetchMock = stubFetch((_url, init) => {
    expect(init.method).toBe("POST");
    return Response.json({ session, revision: { ...proposal, kind: "revision", revision_reason: "Missed work" } });
  });
  const data: OutcomeFormData = {
    outcome: "Delayed",
    actualMinutes: 40,
    revisedRemainingMinutes: 20,
  };

  await expect(recordOutcome("session-1", data, undefined, "Read chapter")).resolves.toMatchObject({
    session: {
      id: "session-1",
      taskId: "task-1",
      taskTitle: "Read chapter",
      outcome: "Delayed",
      actualDuration: 40,
    },
    revision: { id: "proposal-1", reason: "Missed work" },
  });
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/v1/study-sessions/session-1/outcomes",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        outcome: "delayed",
        actual_minutes: 40,
        remaining_minutes: 20,
        large_actual_confirmed: false,
      }),
    }),
  );
});

it("records an outcome without a revision and loads titles when none is supplied", async () => {
  const fetchMock = stubFetch((url) => {
    if (url.endsWith("/outcomes")) return Response.json({ session: { ...session, outcome: null }, revision: null });
    if (url.endsWith("/tasks")) return Response.json([]);
    if (url.endsWith("/progress")) return Response.json([]);
    return Response.json({});
  });

  await expect(recordOutcome("session-1", { outcome: "Missed", actualMinutes: 0 })).resolves.toMatchObject({
    session: { taskTitle: "Untitled task" },
    revision: null,
  });
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/v1/study-sessions/session-1/outcomes",
    expect.objectContaining({ method: "POST" }),
  );
});

it("normalizes a revision without an explicit reason", async () => {
  stubFetch((url) => {
    if (url.endsWith("/outcomes")) {
      return Response.json({
        session,
        revision: { ...proposal, kind: "generation", revision_reason: null },
      });
    }
    return Response.json([]);
  });

  await expect(recordOutcome("session-1", { outcome: "Missed", actualMinutes: 0 }, undefined, "Read chapter"))
    .resolves.toMatchObject({ revision: { reason: "" } });
});

it("maps outcome scheduler failures to the technical error type", async () => {
  stubFetch(() => Response.json({ detail: "Solver timeout" }, { status: 503 }));
  await expect(recordOutcome("session-1", { outcome: "Missed", actualMinutes: 0 }))
    .rejects.toBeInstanceOf(ScheduleTechnicalFailure);

  stubFetch(() => Response.json({ detail: "Bad request" }, { status: 400 }));
  await expect(recordOutcome("session-1", { outcome: "Missed", actualMinutes: 0 }))
    .rejects.toMatchObject({ status: 400 });
});

it("maps adaptive estimates and sends category acknowledgements", async () => {
  const fetchMock = stubFetch((url) => {
    if (url.startsWith("/api/v1/adaptive-estimates/preview")) {
      expect(url).toContain("category=assignment");
      expect(url).toContain("original_minutes=60");
      return Response.json({
        category: "assignment",
        original_minutes: 60,
        adaptive_minutes: 90,
        planned_minutes: 90,
        correction_factor: "1.5",
        history_scope: "category",
        history_count: 6,
        available: true,
        planned_source: "adaptive",
        acknowledgment_required: false,
      });
    }
    return new Response(null, { status: 204 });
  });

  await expect(getAdaptiveEstimate("Assignment", 60)).resolves.toMatchObject({
    adaptiveEstimate: 90,
    factor: 1.5,
    basedOnTasks: 6,
  });
  await acknowledgeAdjustment("Assignment");
  expect(fetchMock).toHaveBeenNthCalledWith(
    2,
    "/api/v1/adaptive-estimates/acknowledgments",
    expect.objectContaining({ method: "POST", body: JSON.stringify({ category: "assignment" }) }),
  );
});
