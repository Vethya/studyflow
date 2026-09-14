import type { Page, Route } from "@playwright/test";

const now = Date.now();
const iso = (offsetMinutes: number) => new Date(now + offsetMinutes * 60_000).toISOString();

export const MOCK_ACCOUNT = {
  id: "account-nfr05",
  email: "student@example.edu",
  name: "Alex Student",
};

export const MOCK_TASKS = [
  {
    id: "task-reading",
    title: "Read cognitive science paper",
    category: "reading" as const,
    priority: "high" as const,
    course: "PSY101",
    notes: "Highlight the main findings.",
    deadline_at: iso(2 * 24 * 60),
    original_estimate_minutes: 90,
    planned_duration_minutes: 90,
    created_at: iso(-3 * 24 * 60),
    updated_at: iso(-3 * 24 * 60),
    status: "not_started" as const,
  },
  {
    id: "task-essay",
    title: "Draft history essay",
    category: "assignment" as const,
    priority: "medium" as const,
    course: "HIS204",
    notes: null,
    deadline_at: iso(7 * 24 * 60),
    original_estimate_minutes: 120,
    planned_duration_minutes: 120,
    created_at: iso(-2 * 24 * 60),
    updated_at: iso(-2 * 24 * 60),
    status: "in_progress" as const,
  },
];

export const MOCK_WINDOWS = [
  { id: "window-mon", weekday: 0, start_time: "18:00:00", end_time: "20:00:00", crosses_midnight: false },
  { id: "window-wed", weekday: 2, start_time: "17:30:00", end_time: "20:30:00", crosses_midnight: false },
  { id: "window-sat", weekday: 5, start_time: "09:00:00", end_time: "12:00:00", crosses_midnight: false },
];

export const MOCK_PERIODS = [
  {
    id: "period-office-hours",
    starts_at: iso(24 * 60 + 30),
    ends_at: iso(24 * 60 + 90),
    reason: "Office hours",
  },
];

export const MOCK_SESSIONS = [
  {
    id: "session-reading",
    task_id: "task-reading",
    starts_at: iso(24 * 60 + 120),
    ends_at: iso(24 * 60 + 165),
    planned_duration_minutes: 45,
    outcome: null,
  },
];

const MOCK_PREFERENCES = {
  timezone: "Asia/Phnom_Penh",
  preferred_session_length_minutes: 45,
  minimum_break_minutes: 10,
  availability_confirmation_required: false,
};

const MOCK_PROPOSAL = {
  id: "proposal-nfr05",
  kind: "generation" as const,
  revision_reason: null,
  status: "feasible" as const,
  created_at: iso(-15),
  sessions: [],
  task_allocations: [],
  unscheduled_work: [],
  overload_warning: null,
  scenario: null,
};

export interface MockApiState {
  unhandledRequests: string[];
  authenticated: boolean;
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function fulfillEmpty(route: Route, status = 204): Promise<void> {
  await route.fulfill({ status });
}

/**
 * Keep NFR-05 runs deterministic and independent of a live account/database.
 * Unexpected API calls are recorded and returned as 404s so the test report
 * shows when a page has acquired an endpoint that its fixture does not cover.
 */
export async function installNfr05ApiMocks(
  page: Page,
  options: { authenticated: boolean },
): Promise<MockApiState> {
  const state: MockApiState = {
    authenticated: options.authenticated,
    unhandledRequests: [],
  };

  await page.addInitScript(() => {
    document.cookie = "studyflow_csrf=nfr05-csrf; Path=/";
  });

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;

    if (path === "/api/v1/auth/session" && method === "GET") {
      if (state.authenticated) {
        await fulfillJson(route, { account: MOCK_ACCOUNT });
      } else {
        await fulfillJson(route, { detail: "Not authenticated" }, 401);
      }
      return;
    }

    if (path === "/api/v1/auth/login" && method === "POST") {
      state.authenticated = true;
      await fulfillJson(route, { account: MOCK_ACCOUNT, csrf_token: "nfr05-csrf" });
      return;
    }

    if (path === "/api/v1/auth/logout" && method === "POST") {
      state.authenticated = false;
      await fulfillEmpty(route);
      return;
    }

    if (path === "/api/v1/tasks" && method === "GET") {
      await fulfillJson(route, MOCK_TASKS);
      return;
    }

    if (path === "/api/v1/tasks" && method === "POST") {
      await fulfillJson(route, MOCK_TASKS[0], 201);
      return;
    }

    if (path === "/api/v1/tasks/task-reading" && method === "GET") {
      await fulfillJson(route, MOCK_TASKS[0]);
      return;
    }

    if (/^\/api\/v1\/tasks\/[^/]+$/.test(path) && method === "PUT") {
      await fulfillJson(route, MOCK_TASKS[0]);
      return;
    }

    if (/^\/api\/v1\/tasks\/[^/]+$/.test(path) && method === "DELETE") {
      await fulfillEmpty(route);
      return;
    }

    if (/^\/api\/v1\/tasks\/[^/]+\/(start|finish-early)$/.test(path) && method === "POST") {
      await fulfillEmpty(route);
      return;
    }

    if (path === "/api/v1/availability/windows" && method === "GET") {
      await fulfillJson(route, MOCK_WINDOWS);
      return;
    }

    if (path === "/api/v1/availability/windows" && method === "PUT") {
      await fulfillJson(route, MOCK_WINDOWS);
      return;
    }

    if (path === "/api/v1/availability/unavailable-periods" && method === "GET") {
      await fulfillJson(route, MOCK_PERIODS);
      return;
    }

    if (path === "/api/v1/availability/unavailable-periods" && method === "POST") {
      await fulfillJson(route, { period: MOCK_PERIODS[0], invalidated_future_session_ids: [] }, 201);
      return;
    }

    if (/^\/api\/v1\/availability\/unavailable-periods\/[^/]+$/.test(path) && method === "PUT") {
      await fulfillJson(route, { period: MOCK_PERIODS[0], invalidated_future_session_ids: [] });
      return;
    }

    if (/^\/api\/v1\/availability\/unavailable-periods\/[^/]+$/.test(path) && method === "DELETE") {
      await fulfillEmpty(route);
      return;
    }

    if (path === "/api/v1/availability/confirm-timezone" && method === "POST") {
      await fulfillEmpty(route);
      return;
    }

    if (path === "/api/v1/availability/study-time" && method === "PUT") {
      await fulfillJson(route, {
        timezone_confirmed: true,
        planning_preferences: MOCK_PREFERENCES,
        recurring_windows: MOCK_WINDOWS,
        added_blocked_periods: [],
        updated_blocked_periods: [],
        removed_blocked_period_ids: [],
        invalidated_future_session_ids: [],
      });
      return;
    }

    if (path === "/api/v1/account/profile" && method === "GET") {
      await fulfillJson(route, MOCK_ACCOUNT);
      return;
    }

    if (path === "/api/v1/account/profile" && method === "PATCH") {
      await fulfillJson(route, MOCK_ACCOUNT);
      return;
    }

    if (path === "/api/v1/account/preferences" && method === "GET") {
      await fulfillJson(route, MOCK_PREFERENCES);
      return;
    }

    if (path === "/api/v1/account/preferences" && method === "PATCH") {
      await fulfillJson(route, MOCK_PREFERENCES);
      return;
    }

    if (path === "/api/v1/account/identities" && method === "GET") {
      await fulfillJson(route, []);
      return;
    }

    if (path === "/api/v1/study-sessions" && method === "GET") {
      await fulfillJson(route, MOCK_SESSIONS);
      return;
    }

    if (/^\/api\/v1\/study-sessions\/[^/]+$/.test(path) && method === "GET") {
      await fulfillJson(route, MOCK_SESSIONS[0]);
      return;
    }

    if (/^\/api\/v1\/study-sessions\/[^/]+\/outcomes$/.test(path) && method === "POST") {
      await fulfillJson(route, {
        session: MOCK_SESSIONS[0],
        outcome: { session_id: MOCK_SESSIONS[0].id, kind: "missed", actual_minutes: 0, remaining_minutes: 45, recorded_at: iso(0), rescheduled_at: null },
        revision: MOCK_PROPOSAL,
      });
      return;
    }

    if (path === "/api/v1/schedule-proposals/current" && method === "GET") {
      await fulfillJson(route, { detail: "No pending proposal" }, 404);
      return;
    }

    if (path === "/api/v1/schedule-proposals" && method === "POST") {
      await fulfillJson(route, MOCK_PROPOSAL, 201);
      return;
    }

    if (path === "/api/v1/schedule-proposals/simulate" && method === "POST") {
      await fulfillJson(route, {
        proposal: MOCK_PROPOSAL,
        active_schedule_changed: false,
        requires_user_review: false,
        persisted: false,
      });
      return;
    }

    if (/^\/api\/v1\/schedule-proposals\/[^/]+\/(accept|reject)$/.test(path) && method === "POST") {
      await fulfillEmpty(route);
      return;
    }

    state.unhandledRequests.push(`${method} ${path}`);
    await fulfillJson(route, { detail: `NFR-05 fixture does not cover ${method} ${path}` }, 404);
  });

  return state;
}
