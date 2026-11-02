/**
 * In-memory stand-in for the StudyFlow FastAPI backend, for UI work without
 * Docker, Python or a database. Responses follow the wire shapes in
 * `lib/api/wire.ts`; state is seeded fresh on every start.
 *
 *   node dev/mock-api/server.mjs          # standalone, port MOCK_API_PORT or 8010
 *   import { startMockApi } from "./server.mjs"
 */

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  CALENDAR_IMPORT_ID,
  CLASSROOM_IMPORT_ID,
  ADAPTIVE_HISTORY,
  calendarImportItems,
  classroomImportItems,
  createNewStudentState,
  createSeedState,
} from "./seed.mjs";

/** The mock's accounts, by sign-in email. Each one gets its own data. */
const ACCOUNT_FACTORIES = [createSeedState, createNewStudentState];
import {
  DAY,
  MINUTE,
  ceilTo,
  clip,
  isValidTimeZone,
  iso,
  mergeIntervals,
  parseAbsolute,
  subtractIntervals,
  totalMinutes,
  windowIntervals,
} from "./time.mjs";

const API_PREFIX = "/api/v1";
const CATEGORIES = ["assignment", "reading", "exam_preparation", "project", "research_writing", "other"];
const PRIORITIES = ["low", "medium", "high"];
const STATUSES = ["not_started", "in_progress", "completed", "overdue"];
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
const MAX_DURATION_MINUTES = 1440;
const LARGE_ACTUAL_FACTOR = 2;

class HttpError extends Error {
  constructor(status, detail, headers = {}) {
    super(typeof detail === "string" ? detail : JSON.stringify(detail));
    this.status = status;
    this.detail = detail;
    this.headers = headers;
  }
}

const fail = (status, detail) => {
  throw new HttpError(status, detail);
};

/** A Pydantic-style 422 for one request field. */
const invalidField = (field, msg, type = "value_error") =>
  fail(422, [{ type, loc: ["body", field], msg, input: null }]);

// ─── Derived values ──────────────────────────────────────────────

function taskStatus(task, now = Date.now()) {
  if (task.completedAt !== null) return "completed";
  if (task.deadline <= now) return "overdue";
  return task.frozen ? "in_progress" : "not_started";
}

/** Work already represented by recorded outcomes, per task (see backend `task_schedule_adjustments`). */
function scheduleAdjustments(state) {
  const adjustments = new Map();
  for (const session of state.sessions) {
    if (!session.outcome) continue;
    const value = session.planned - session.outcome.remaining;
    adjustments.set(session.taskId, (adjustments.get(session.taskId) ?? 0) + value);
  }
  return adjustments;
}

function remainingMinutes(state, task, adjustments = scheduleAdjustments(state)) {
  if (task.completedAt !== null) return 0;
  return Math.max(task.planned - (adjustments.get(task.id) ?? 0), 0);
}

function progressRows(state) {
  const now = Date.now();
  const adjustments = scheduleAdjustments(state);
  return state.tasks.map((task) => {
    let actual = 0;
    let completed = 0;
    let upcoming = 0;
    for (const session of state.sessions) {
      if (session.taskId !== task.id) continue;
      if (!session.outcome) {
        if (session.startsAt > now) upcoming += 1;
        continue;
      }
      if (session.outcome.kind !== "missed") actual += session.outcome.actual;
      if (session.outcome.kind === "completed") completed += 1;
    }
    const remaining = remainingMinutes(state, task, adjustments);
    const denominator = actual + remaining;
    return {
      task_id: task.id,
      task_title: task.title,
      actual_duration_minutes: actual,
      estimated_remaining_minutes: remaining,
      effort_percent: denominator === 0 ? 0 : Math.floor((actual * 100 + Math.floor(denominator / 2)) / denominator),
      sessions_completed: completed,
      sessions_upcoming: upcoming,
      status: taskStatus(task, now),
      estimation_accuracy: state.estimationAccuracy ?? null,
    };
  });
}

function adaptivePreview(state, category, originalMinutes) {
  const history = (state.adaptiveHistory ?? ADAPTIVE_HISTORY)[category];
  if (!history) {
    return {
      category,
      original_minutes: originalMinutes,
      adaptive_minutes: null,
      planned_minutes: originalMinutes,
      correction_factor: null,
      history_scope: null,
      history_count: null,
      available: false,
      planned_source: "original",
      acknowledgment_required: false,
      low_minutes: null,
      high_minutes: null,
      sample_size: null,
      basis: null,
    };
  }
  const adaptive = Math.max(1, Math.round(originalMinutes * Number(history.factor)));
  const acknowledgmentRequired = Boolean(history.acknowledgmentRequired) && !state.acknowledged.has(category);
  return {
    category,
    original_minutes: originalMinutes,
    adaptive_minutes: adaptive,
    planned_minutes: acknowledgmentRequired ? originalMinutes : adaptive,
    correction_factor: history.factor,
    history_scope: history.scope,
    history_count: history.count,
    available: true,
    planned_source: acknowledgmentRequired ? "original" : "adaptive",
    acknowledgment_required: acknowledgmentRequired,
    low_minutes: Math.max(1, Math.round(adaptive * history.spread[0])),
    high_minutes: Math.max(1, Math.round(adaptive * history.spread[1])),
    sample_size: history.count,
    basis: {
      scope: history.basisScope,
      size_bucket: originalMinutes < 60 ? "small" : originalMinutes <= 240 ? "medium" : "large",
      completed_records: history.count - history.provisional,
      provisional_records: history.provisional,
      category_records: history.basisScope === "category" ? history.count - 1 : Math.ceil(history.count / 3),
      size_records: history.basisScope === "size" ? history.count - 2 : Math.ceil(history.count / 2),
    },
  };
}

// ─── Wire serialisers ────────────────────────────────────────────

const accountWire = (state) => ({
  id: state.account.id,
  email: state.account.email,
  name: state.account.name,
});

const profileWire = (state) => ({ ...accountWire(state), password_set: state.account.passwordSet });

const taskWire = (task) => ({
  id: task.id,
  title: task.title,
  category: task.category,
  priority: task.priority,
  course: task.course,
  notes: task.notes,
  deadline_at: iso(task.deadline),
  original_estimate_minutes: task.original,
  adaptive_estimate_minutes: task.adaptive,
  planned_source: task.plannedSource,
  planned_duration_minutes: task.planned,
  estimate_frozen: task.frozen,
  created_at: iso(task.createdAt),
  updated_at: iso(task.updatedAt),
  status: taskStatus(task),
});

const outcomeWire = (session) => ({
  session_id: session.id,
  kind: session.outcome.kind,
  actual_minutes: session.outcome.actual,
  remaining_minutes: session.outcome.remaining,
  recorded_at: iso(session.outcome.recordedAt),
  rescheduled_at: session.outcome.rescheduledAt === null ? null : iso(session.outcome.rescheduledAt),
});

const sessionWire = (state, session) => {
  const task = state.tasks.find((item) => item.id === session.taskId);
  return {
    id: session.id,
    task_id: session.taskId,
    task_title: task?.title ?? null,
    task_category: task?.category ?? null,
    starts_at: iso(session.startsAt),
    ends_at: iso(session.endsAt),
    planned_duration_minutes: session.planned,
    outcome: session.outcome ? outcomeWire(session) : null,
  };
};

const windowWire = (window) => ({
  id: window.id,
  weekday: window.weekday,
  start_time: `${window.start}:00`,
  end_time: `${window.end}:00`,
  crosses_midnight: window.end <= window.start,
});

const periodWire = (period) => ({
  id: period.id,
  starts_at: iso(period.startsAt),
  ends_at: iso(period.endsAt),
  reason: period.reason,
});

function proposedSessionWire(state, session) {
  return {
    id: session.id,
    task_id: session.taskId,
    task_title: state.tasks.find((task) => task.id === session.taskId)?.title ?? null,
    starts_at: iso(session.startsAt),
    ends_at: iso(session.endsAt),
    planned_duration_minutes: session.planned,
  };
}

function proposalWire(state, proposal) {
  const title = (taskId) => state.tasks.find((task) => task.id === taskId)?.title ?? null;
  const allocations = proposal.allocations.map((item) => ({
    task_id: item.taskId,
    task_title: title(item.taskId),
    deadline_at: iso(item.deadline),
    required_minutes: item.required,
    scheduled_minutes: item.scheduled,
    unscheduled_minutes: item.required - item.scheduled,
    raw_calendar_capacity_minutes: item.rawCapacity,
    available_minutes_before_deadline: item.available,
    shortfall_minutes: item.required - item.scheduled,
  }));
  const unscheduled = allocations
    .filter((item) => item.unscheduled_minutes > 0)
    .map((item) => ({
      task_id: item.task_id,
      task_title: item.task_title,
      required_minutes: item.required_minutes,
      available_minutes_before_deadline: item.available_minutes_before_deadline,
      shortfall_minutes: item.shortfall_minutes,
      unscheduled_minutes: item.unscheduled_minutes,
    }));
  const overloaded = unscheduled.length > 0;
  const unscheduledDeadlines = proposal.allocations
    .filter((item) => item.required > item.scheduled)
    .map((item) => item.deadline);
  return {
    id: proposal.id,
    kind: proposal.kind,
    revision_reason: proposal.reason,
    status: overloaded ? "overload" : "feasible",
    created_at: iso(proposal.createdAt),
    sessions: [...proposal.sessions]
      .sort((a, b) => a.startsAt - b.startsAt)
      .map((session) => proposedSessionWire(state, session)),
    task_allocations: allocations,
    unscheduled_work: unscheduled,
    overload_warning: overloaded
      ? {
          affected_tasks: unscheduled,
          relevant_unavailable_periods: [...state.periods]
            .sort((a, b) => a.startsAt - b.startsAt)
            .filter(
              (period) =>
                period.endsAt > proposal.createdAt &&
                unscheduledDeadlines.some((deadline) => period.startsAt < deadline),
            )
            .map(periodWire),
          remedies: ["extend_deadline", "add_availability"],
        }
      : null,
    scenario: proposal.scenario,
  };
}

// ─── Scheduling ──────────────────────────────────────────────────

function normaliseScenario(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object") invalidField("scenario", "Input should be a valid object", "model_type");
  const range = (item, field) => {
    const startsAt = parseAbsolute(item?.starts_at);
    const endsAt = parseAbsolute(item?.ends_at);
    if (startsAt === null || endsAt === null) fail(422, `${field} times must include a UTC offset`);
    if (endsAt <= startsAt) fail(422, `${field} must end after it starts`);
    return { startsAt, endsAt };
  };
  const availability = (raw.temporary_availability ?? []).map((item) => range(item, "Temporary availability"));
  const blocked = (raw.temporary_blocked_periods ?? []).map((item) => ({
    ...range(item, "Temporary blocked period"),
    reason: typeof item.reason === "string" && item.reason.trim() ? item.reason.trim() : null,
  }));
  const deadlines = (raw.deadline_overrides ?? []).map((item) => {
    const deadline = parseAbsolute(item?.deadline_at);
    if (deadline === null) fail(422, "Deadline overrides must include a UTC offset");
    return { taskId: String(item.task_id), deadline };
  });
  if (availability.length + blocked.length + deadlines.length === 0) return null;
  return { availability, blocked, deadlines };
}

const scenarioWire = (scenario) =>
  scenario && {
    temporary_availability: scenario.availability.map((item) => ({
      starts_at: iso(item.startsAt),
      ends_at: iso(item.endsAt),
    })),
    temporary_blocked_periods: scenario.blocked.map((item) => ({
      starts_at: iso(item.startsAt),
      ends_at: iso(item.endsAt),
      reason: item.reason,
    })),
    deadline_overrides: scenario.deadlines.map((item) => ({
      task_id: item.taskId,
      deadline_at: iso(item.deadline),
    })),
  };

/**
 * A greedy stand-in for the CP-SAT planner: earliest deadline first, then
 * priority, packing preferred-length sessions into free time with the
 * minimum break around each one. Work that does not fit is reported as
 * Overload, exactly where the real planner would report it.
 */
function planSchedule(state, { kind = "generation", reason = null, scenario = null } = {}) {
  const now = Date.now();
  const tz = state.preferences.timezone;
  const sessionLength = state.preferences.preferred_session_length_minutes;
  const breakMs = state.preferences.minimum_break_minutes * MINUTE;
  const planningStart = ceilTo(now + 15 * MINUTE, 5);
  const overrides = new Map((scenario?.deadlines ?? []).map((item) => [item.taskId, item.deadline]));
  const adjustments = scheduleAdjustments(state);

  // Finished sessions still awaiting an outcome keep their work allocated.
  const awaiting = new Map();
  for (const session of state.sessions) {
    if (session.outcome || session.endsAt > now) continue;
    awaiting.set(session.taskId, (awaiting.get(session.taskId) ?? 0) + session.planned);
  }

  const demand = state.tasks
    .filter((task) => task.completedAt === null)
    .map((task) => ({
      task,
      deadline: overrides.get(task.id) ?? task.deadline,
      required: Math.max(remainingMinutes(state, task, adjustments) - (awaiting.get(task.id) ?? 0), 0),
    }))
    .filter((item) => item.required > 0)
    .sort(
      (a, b) =>
        a.deadline - b.deadline ||
        PRIORITY_RANK[a.task.priority] - PRIORITY_RANK[b.task.priority] ||
        a.task.title.localeCompare(b.task.title),
    );

  const horizon = Math.min(
    Math.max(planningStart, ...demand.map((item) => item.deadline)),
    planningStart + 120 * DAY,
  );
  const raw = mergeIntervals([
    ...windowIntervals(state.windows, planningStart, horizon, tz),
    ...clip(
      (scenario?.availability ?? []).map((item) => ({ start: item.startsAt, end: item.endsAt })),
      planningStart,
      horizon,
    ),
  ]);
  const blocked = [
    ...state.periods.map((period) => ({ start: period.startsAt, end: period.endsAt })),
    ...(scenario?.blocked ?? []).map((item) => ({ start: item.startsAt, end: item.endsAt })),
  ];
  const available = subtractIntervals(raw, blocked);
  const running = state.sessions
    .filter((session) => session.startsAt <= now && session.endsAt > now)
    .map((session) => ({ start: session.startsAt - breakMs, end: session.endsAt + breakMs }));
  let free = subtractIntervals(available, running);

  const sessions = [];
  const allocations = [];
  for (const item of demand) {
    let remaining = item.required;
    while (remaining > 0) {
      const minimum = Math.min(remaining, 15) * MINUTE;
      const slot = free.find((interval) => Math.min(interval.end, item.deadline) - interval.start >= minimum);
      if (!slot) break;
      const room = Math.floor((Math.min(slot.end, item.deadline) - slot.start) / MINUTE);
      const length = Math.min(sessionLength, remaining, room);
      const startsAt = slot.start;
      const endsAt = startsAt + length * MINUTE;
      sessions.push({ id: randomUUID(), taskId: item.task.id, startsAt, endsAt, planned: length });
      remaining -= length;
      free = subtractIntervals(free, [{ start: startsAt - breakMs, end: endsAt + breakMs }]);
    }
    allocations.push({
      taskId: item.task.id,
      deadline: item.deadline,
      required: item.required,
      scheduled: item.required - remaining,
      rawCapacity: totalMinutes(clip(raw, planningStart, item.deadline)),
      available: totalMinutes(clip(available, planningStart, item.deadline)),
    });
  }
  allocations.sort((a, b) => a.deadline - b.deadline || a.taskId.localeCompare(b.taskId));

  return {
    id: randomUUID(),
    kind,
    reason,
    createdAt: now,
    sessions,
    allocations,
    scenario: scenarioWire(scenario),
  };
}

/** Drops future sessions that no longer fit availability; returns their ids. */
function invalidateFutureSessions(state) {
  const now = Date.now();
  const tz = state.preferences.timezone;
  const invalidated = [];
  state.sessions = state.sessions.filter((session) => {
    if (session.outcome || session.startsAt <= now) return true;
    const blocked = state.periods.some(
      (period) => period.startsAt < session.endsAt && period.endsAt > session.startsAt,
    );
    const inWindow =
      session.outsideWindows ||
      windowIntervals(state.windows, session.startsAt - DAY, session.endsAt + DAY, tz).some(
        (interval) => interval.start <= session.startsAt && interval.end >= session.endsAt,
      );
    if (!blocked && inWindow) return true;
    invalidated.push(session.id);
    return false;
  });
  return invalidated;
}

function dropTaskWork(state, taskId, { includePast = false } = {}) {
  const now = Date.now();
  state.sessions = state.sessions.filter(
    (session) =>
      session.taskId !== taskId || (!includePast && (session.outcome !== null || session.startsAt <= now)),
  );
  if (state.proposal?.sessions.some((session) => session.taskId === taskId)) state.proposal = null;
}

// ─── Request validation helpers ──────────────────────────────────

function requireInt(value, field, { min = 1, max = MAX_DURATION_MINUTES } = {}) {
  if (!Number.isInteger(value)) invalidField(field, "Input should be a valid integer", "int_type");
  if (value < min) invalidField(field, `Input should be greater than or equal to ${min}`, "greater_than_equal");
  if (value > max) invalidField(field, `Input should be less than or equal to ${max}`, "less_than_equal");
  return value;
}

function requireClock(value, field) {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d(:00)?$/.test(value)) {
    invalidField(field, "Availability times must be local minute values");
  }
  return value.slice(0, 5);
}

function parseWindows(list) {
  if (!Array.isArray(list)) invalidField("windows", "Input should be a valid list", "list_type");
  if (list.length > 100) invalidField("windows", "List should have at most 100 items", "too_long");
  const drafts = list.map((item) => {
    const weekday = requireInt(item?.weekday, "weekday", { min: 0, max: 6 });
    const start = requireClock(item?.start_time, "start_time");
    const end = requireClock(item?.end_time, "end_time");
    if (start === end) fail(422, "Availability windows must not be empty");
    return { weekday, start, end };
  });
  // Overlapping same-day windows merge, as on the server.
  const merged = [];
  for (const draft of drafts.sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start))) {
    const last = merged[merged.length - 1];
    const crosses = (window) => window.end <= window.start;
    if (last && last.weekday === draft.weekday && !crosses(last) && !crosses(draft) && draft.start <= last.end) {
      if (draft.end > last.end) last.end = draft.end;
    } else {
      merged.push({ ...draft });
    }
  }
  return merged.map((draft) => ({ id: randomUUID(), ...draft }));
}

function parsePeriodDraft(body) {
  const startsAt = parseAbsolute(body?.starts_at);
  const endsAt = parseAbsolute(body?.ends_at);
  if (startsAt === null) invalidField("starts_at", "Input should be a valid datetime with a UTC offset", "datetime_parsing");
  if (endsAt === null) invalidField("ends_at", "Input should be a valid datetime with a UTC offset", "datetime_parsing");
  if (endsAt <= startsAt) fail(422, "Unavailable periods must end after they start");
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null;
  if (reason && reason.length > 200) invalidField("reason", "String should have at most 200 characters", "string_too_long");
  return { startsAt, endsAt, reason };
}

function parsePreferences(state, body) {
  if (!body || typeof body !== "object") fail(422, "Preferences are required");
  if (!isValidTimeZone(body.timezone)) invalidField("timezone", "Timezone must be a valid IANA timezone");
  return {
    ...state.preferences,
    timezone: body.timezone,
    preferred_session_length_minutes: requireInt(body.preferred_session_length_minutes, "preferred_session_length_minutes", { min: 15, max: 240 }),
    minimum_break_minutes: requireInt(body.minimum_break_minutes, "minimum_break_minutes", { min: 0, max: 120 }),
  };
}

function parseTaskBody(state, body, existing = null) {
  const now = Date.now();
  if (!body || typeof body !== "object") fail(422, "A task body is required");
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) invalidField("title", "String should have at least 1 character", "string_too_short");
  if (title.length > 200) invalidField("title", "String should have at most 200 characters", "string_too_long");
  if (!CATEGORIES.includes(body.category)) invalidField("category", `Input should be ${CATEGORIES.map((c) => `'${c}'`).join(", ")}`, "enum");
  if (!PRIORITIES.includes(body.priority)) invalidField("priority", "Input should be 'low', 'medium' or 'high'", "enum");
  const original = requireInt(body.original_estimate_minutes, "original_estimate_minutes", { min: 1, max: 100_000 });
  const deadline = parseAbsolute(body.deadline_at);
  const deadlineChanged = !existing || deadline !== existing.deadline;
  if (deadline === null || (deadlineChanged && deadline <= now)) {
    fail(422, "Deadline must be a future absolute date and time");
  }
  if (existing?.frozen && original !== existing.original) {
    fail(409, "Original estimate is frozen after work starts");
  }
  const requestedSource = body.planned_source ?? existing?.plannedSource ?? "original";
  if (!["original", "adaptive"].includes(requestedSource)) invalidField("planned_source", "Input should be 'original' or 'adaptive'", "enum");
  const preview = adaptivePreview(state, body.category, original);
  if (requestedSource === "adaptive" && (!preview.available || preview.acknowledgment_required)) {
    fail(409, {
      code: "adaptive_estimate_conflict",
      message:
        "Adaptive planning changed. Refresh the estimate, then choose Original or acknowledge the updated suggestion before retrying.",
    });
  }
  const adaptive = preview.adaptive_minutes;
  return {
    title,
    category: body.category,
    priority: body.priority,
    course: typeof body.course === "string" && body.course.trim() ? body.course.trim() : null,
    notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null,
    deadline,
    original,
    adaptive,
    plannedSource: requestedSource,
    planned: requestedSource === "adaptive" ? adaptive : original,
  };
}

// ─── Google import fixtures ──────────────────────────────────────

function calendarImportWire(state) {
  const now = Date.now();
  return {
    id: CALENDAR_IMPORT_ID,
    source: "google_calendar",
    expires_at: iso(now + 30 * MINUTE),
    items: calendarImportItems(now, state.preferences.timezone).map((item) => {
      const existing = state.periods.find((period) => period.importKey === item.id);
      const status = !existing
        ? "new"
        : existing.startsAt === item.startsAt && existing.endsAt === item.endsAt
          ? "unchanged"
          : "changed";
      return {
        id: item.id,
        title: item.title,
        starts_at: iso(item.startsAt),
        ends_at: iso(item.endsAt),
        all_day: item.allDay,
        status,
      };
    }),
  };
}

function classroomImportWire(state) {
  const now = Date.now();
  return {
    id: CLASSROOM_IMPORT_ID,
    source: "google_classroom",
    expires_at: iso(now + 30 * MINUTE),
    items: classroomImportItems(now, state.preferences.timezone).map((item) => ({
      id: item.id,
      title: item.title,
      course: item.course,
      due_at: iso(item.dueAt),
      link: item.link,
      suggested_category: item.suggestedCategory,
      status: state.tasks.some((task) => task.importedFrom === item.id) ? "already_imported" : "new",
    })),
  };
}

// ─── Routes ──────────────────────────────────────────────────────

const routes = [];
/** `options.public` routes answer without a session. */
const route = (method, pattern, handler, options = {}) => {
  const keys = [];
  const regex = new RegExp(
    `^${pattern.replace(/:([a-zA-Z]+)/g, (_match, key) => {
      keys.push(key);
      return "([^/]+)";
    })}$`,
  );
  routes.push({ method, pattern, regex, keys, handler, public: Boolean(options.public) });
};

const json = (status, body, headers = {}) => ({ status, body, headers });
const noContent = (headers = {}) => ({ status: 204, body: undefined, headers });

function sessionCookies(state) {
  return [
    `studyflow_session=${state.account.id}; Path=/; HttpOnly; SameSite=Strict`,
    `studyflow_csrf=${state.csrfToken}; Path=/; SameSite=Strict`,
  ];
}

const clearedCookies = [
  "studyflow_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
  "studyflow_csrf=; Path=/; SameSite=Strict; Max-Age=0",
];

function signIn(ctx) {
  const { state } = ctx;
  state.signedIn = true;
  state.csrfToken = randomUUID().replaceAll("-", "");
  return { "Set-Cookie": sessionCookies(state) };
}

function findTask(state, id) {
  return state.tasks.find((task) => task.id === id) ?? fail(404, "Task not found");
}

function findSession(state, id) {
  return state.sessions.find((session) => session.id === id) ?? fail(404, "Study session not found");
}

function findPeriod(state, id) {
  return state.periods.find((period) => period.id === id) ?? fail(404, "Unavailable period not found");
}

const message = (text) => ({ message: text });

// Health
route("GET", "/health", () => json(200, { service: "studyflow-api", status: "ok", version: "mock" }), { public: true });
route("GET", "/ready", () => json(200, { service: "studyflow-api", status: "ready", database: "reachable" }), { public: true });

// Authentication
route("GET", "/auth/session", (ctx) => {
  if (!ctx.state.signedIn) fail(401, "Not authenticated");
  return json(200, { account: accountWire(ctx.state) }, { "Set-Cookie": sessionCookies(ctx.state) });
}, { public: true });

route("POST", "/auth/login", (ctx) => {
  const { email, password } = ctx.body ?? {};
  if (typeof email !== "string" || !email.includes("@")) invalidField("email", "value is not a valid email address");
  if (typeof password !== "string" || password.length === 0) invalidField("password", "Field required", "missing");
  // Any email not listed signs into the demo account, as before.
  ctx.switchAccount(email);
  const headers = signIn(ctx);
  return json(200, { account: accountWire(ctx.state), csrf_token: ctx.state.csrfToken }, headers);
}, { public: true });

route("POST", "/auth/logout", (ctx) => {
  ctx.state.signedIn = false;
  return noContent({ "Set-Cookie": clearedCookies });
}, { public: true });

route("POST", "/auth/register", () => json(202, message("Check your inbox for a verification link.")), { public: true });
route("POST", "/auth/resend-verification", () => json(202, message("If that address is waiting for verification, a new link is on its way.")), { public: true });
route("POST", "/auth/verify-email", () => json(200, { signup_token: `mock-signup-${randomUUID()}` }), { public: true });
route("POST", "/auth/complete-registration", () => json(201, message("Your account is ready. Sign in to continue.")), { public: true });
route("POST", "/auth/forgot-password", () => json(202, message("If an account exists for that address, a reset link is on its way.")), { public: true });
route("POST", "/auth/reset-password", (ctx) => {
  const password = ctx.body?.password;
  if (typeof password !== "string" || password.length < 12) {
    invalidField("password", "String should have at least 12 characters", "string_too_short");
  }
  ctx.state.password = password;
  return noContent();
}, { public: true });

// There is no Google in mock mode: signing in "with Google" signs straight in.
route("POST", "/auth/google/start", (ctx) => {
  const headers = signIn(ctx);
  return json(200, { authorization_url: "/dashboard" }, headers);
}, { public: true });

route("POST", "/auth/google/link/start", (ctx) => {
  const { state } = ctx;
  if (!state.identities.some((identity) => identity.provider === "google")) {
    state.identities.push({ provider: "google", email: state.account.email, linked_at: iso(Date.now()) });
  }
  return json(200, { authorization_url: "/settings" });
});

route("POST", "/auth/google/account-deletion/start", () =>
  fail(503, "Google re-authentication is not available in UI mock mode. Confirm with your password instead."),
);

route("GET", "/auth/google/link/browser", () => fail(401, "No pending Google link"), { public: true });
route("POST", "/auth/google/link/browser", (ctx) => {
  const headers = signIn(ctx);
  const { state } = ctx;
  if (!state.identities.some((identity) => identity.provider === "google")) {
    state.identities.push({ provider: "google", email: state.account.email, linked_at: iso(Date.now()) });
  }
  return json(200, { account: accountWire(state), csrf_token: state.csrfToken }, headers);
}, { public: true });

// Account
route("GET", "/account/profile", (ctx) => json(200, profileWire(ctx.state)));
route("PATCH", "/account/profile", (ctx) => {
  const name = typeof ctx.body?.name === "string" ? ctx.body.name.trim() : "";
  if (!name) invalidField("name", "String should have at least 1 character", "string_too_short");
  if (name.length > 100) invalidField("name", "String should have at most 100 characters", "string_too_long");
  ctx.state.account.name = name;
  return json(200, profileWire(ctx.state));
});
route("GET", "/account/preferences", (ctx) => json(200, ctx.state.preferences));
route("PATCH", "/account/preferences", (ctx) => {
  const { state } = ctx;
  const timezoneChanged = ctx.body?.timezone !== state.preferences.timezone;
  state.preferences = parsePreferences(state, ctx.body);
  if (timezoneChanged) invalidateFutureSessions(state);
  return json(200, state.preferences);
});
route("GET", "/account/identities", (ctx) => json(200, ctx.state.identities));

// Reminders. Delivery is never configured locally, matching a server without a dispatch token.
function reminderWire(state) {
  state.reminders ??= { email_enabled: false, before_session_minutes: 30, after_session: true };
  return { ...state.reminders, email_verified: true, delivery_available: false };
}
route("GET", "/reminders/preferences", (ctx) => json(200, reminderWire(ctx.state)));
route("PUT", "/reminders/preferences", (ctx) => {
  const body = ctx.body ?? {};
  if (typeof body.email_enabled !== "boolean") invalidField("email_enabled", "Input should be a valid boolean", "bool_type");
  if (typeof body.after_session !== "boolean") invalidField("after_session", "Input should be a valid boolean", "bool_type");
  const lead = body.before_session_minutes;
  if (!Number.isInteger(lead) || (lead !== 0 && (lead < 30 || lead > 120))) {
    invalidField("before_session_minutes", "Use 0 or a value from 30 to 120", "value_error");
  }
  ctx.state.reminders = {
    email_enabled: body.email_enabled,
    before_session_minutes: lead,
    after_session: body.after_session,
  };
  return json(200, reminderWire(ctx.state));
});
route("PATCH", "/account/password", (ctx) => {
  const { state } = ctx;
  const { current_password: current, new_password: next } = ctx.body ?? {};
  if (state.account.passwordSet && typeof current !== "string") {
    invalidField("current_password", "Enter your current password", "missing");
  }
  if (typeof next !== "string" || next.length < 12) {
    invalidField("new_password", "String should have at least 12 characters", "string_too_short");
  }
  state.password = next;
  state.account.passwordSet = true;
  return noContent();
});
route("POST", "/account/deletion/prepare", (ctx) => {
  if (ctx.state.account.passwordSet && typeof ctx.body?.current_password !== "string") {
    invalidField("current_password", "Enter your current password", "missing");
  }
  ctx.state.deletionReady = true;
  return noContent();
});
route("GET", "/account/deletion/status", (ctx) => json(200, { ready: ctx.state.deletionReady }));
route("POST", "/account/deletion/confirm", (ctx) => {
  if (ctx.body?.confirmation !== "DELETE") invalidField("confirmation", "Type DELETE to confirm");
  if (!ctx.state.deletionReady) fail(409, "Confirm your identity before deleting the account");
  // Deleting a mock account resets it; the next sign-in starts fresh.
  ctx.resetAccount();
  return noContent({ "Set-Cookie": clearedCookies });
});

// Tasks
route("GET", "/tasks", (ctx) => {
  const { query } = ctx;
  const filterDeadline = (name) => {
    const value = query.get(name);
    if (value === null || value === "") return null;
    const parsed = parseAbsolute(value);
    if (parsed === null) fail(422, "Deadline filters must include a UTC offset");
    return parsed;
  };
  const from = filterDeadline("deadline_from");
  const to = filterDeadline("deadline_to");
  if (from !== null && to !== null && from > to) fail(422, "deadline_from must not be after deadline_to");
  const course = query.get("course");
  const category = query.get("category");
  const priority = query.get("priority");
  const status = query.get("status");
  const text = query.get("query")?.trim().toLowerCase();
  if (category && !CATEGORIES.includes(category)) fail(422, "Unknown category");
  if (priority && !PRIORITIES.includes(priority)) fail(422, "Unknown priority");
  if (status && !STATUSES.includes(status)) fail(422, "Unknown status");
  let rows = ctx.state.tasks.filter(
    (task) =>
      (!course || task.course === course) &&
      (!category || task.category === category) &&
      (!priority || task.priority === priority) &&
      (!status || taskStatus(task) === status) &&
      (from === null || task.deadline >= from) &&
      (to === null || task.deadline <= to) &&
      (!text ||
        task.title.toLowerCase().includes(text) ||
        (task.course ?? "").toLowerCase().includes(text) ||
        (task.notes ?? "").toLowerCase().includes(text)),
  );
  const pageParam = (name, min, max) => {
    const raw = query.get(name);
    if (raw === null || raw === "") return null;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || (max !== null && value > max)) {
      fail(422, [{ type: "int_parsing", loc: ["query", name], msg: max === null ? `Input should be greater than or equal to ${min}` : `Input should be between ${min} and ${max}`, input: raw }]);
    }
    return value;
  };
  const limit = pageParam("limit", 1, 100);
  const offset = pageParam("offset", 0, null) ?? 0;
  rows = rows.sort((a, b) => a.deadline - b.deadline || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const total = rows.length;
  const page = rows.slice(offset, limit === null ? undefined : offset + limit);
  return json(200, page.map(taskWire), { "X-Total-Count": String(total) });
});

route("POST", "/tasks", (ctx) => {
  const now = Date.now();
  const fields = parseTaskBody(ctx.state, ctx.body);
  const task = {
    id: randomUUID(),
    ...fields,
    frozen: false,
    completedAt: null,
    importedFrom: null,
    createdAt: now,
    updatedAt: now,
  };
  ctx.state.tasks.push(task);
  return json(201, taskWire(task), { Location: `${API_PREFIX}/tasks/${task.id}` });
});

route("GET", "/tasks/:id", (ctx) => json(200, taskWire(findTask(ctx.state, ctx.params.id))));

route("PUT", "/tasks/:id", (ctx) => {
  const task = findTask(ctx.state, ctx.params.id);
  Object.assign(task, parseTaskBody(ctx.state, ctx.body, task), { updatedAt: Date.now() });
  return json(200, taskWire(task));
});

route("POST", "/tasks/:id/start", (ctx) => {
  const task = findTask(ctx.state, ctx.params.id);
  task.frozen = true;
  task.updatedAt = Date.now();
  return noContent();
});

route("POST", "/tasks/:id/finish-early", (ctx) => {
  const task = findTask(ctx.state, ctx.params.id);
  if (ctx.body?.confirmed !== true) fail(422, "Finishing early requires confirmation");
  if (!task.frozen) fail(409, "Task must be started before it can be finished");
  if (task.completedAt === null) {
    task.completedAt = Date.now();
    task.updatedAt = task.completedAt;
    dropTaskWork(ctx.state, task.id);
  }
  return noContent();
});

route("DELETE", "/tasks/:id", (ctx) => {
  const task = findTask(ctx.state, ctx.params.id);
  if (ctx.query.get("confirmed") !== "true") fail(422, "Task deletion requires confirmation");
  ctx.state.tasks = ctx.state.tasks.filter((item) => item.id !== task.id);
  dropTaskWork(ctx.state, task.id, { includePast: true });
  return noContent();
});

// Progress and adaptive estimates
route("GET", "/progress", (ctx) => json(200, progressRows(ctx.state)));

route("GET", "/adaptive-estimates/preview", (ctx) => {
  const category = ctx.query.get("category");
  const original = Number(ctx.query.get("original_minutes"));
  if (!CATEGORIES.includes(category)) {
    fail(422, [{ type: "enum", loc: ["query", "category"], msg: "Input should be a valid category", input: category }]);
  }
  if (!Number.isInteger(original) || original < 1) {
    fail(422, [{ type: "greater_than_equal", loc: ["query", "original_minutes"], msg: "Input should be greater than or equal to 1", input: original }]);
  }
  return json(200, adaptivePreview(ctx.state, category, original));
});

route("POST", "/adaptive-estimates/acknowledgments", (ctx) => {
  const category = ctx.body?.category;
  if (!CATEGORIES.includes(category)) invalidField("category", "Input should be a valid category", "enum");
  ctx.state.acknowledged.add(category);
  return noContent();
});

// Availability
route("GET", "/availability/windows", (ctx) =>
  json(200, [...ctx.state.windows].sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start)).map(windowWire)),
);

route("PUT", "/availability/windows", (ctx) => {
  ctx.state.windows = parseWindows(ctx.body?.windows);
  const invalidated = invalidateFutureSessions(ctx.state);
  return json(200, { windows: ctx.state.windows.map(windowWire), invalidated_future_session_ids: invalidated });
});

route("POST", "/availability/confirm-timezone", (ctx) => {
  if (ctx.body?.confirmed !== true) invalidField("confirmed", "Input should be True", "literal_error");
  ctx.state.preferences.availability_confirmation_required = false;
  return json(200, { invalidated_future_session_ids: invalidateFutureSessions(ctx.state) });
});

route("GET", "/availability/unavailable-periods", (ctx) =>
  json(200, [...ctx.state.periods].sort((a, b) => a.startsAt - b.startsAt).map(periodWire)),
);

route("POST", "/availability/unavailable-periods", (ctx) => {
  const period = { id: randomUUID(), importKey: null, ...parsePeriodDraft(ctx.body) };
  ctx.state.periods.push(period);
  const invalidated = invalidateFutureSessions(ctx.state);
  return json(201, { period: periodWire(period), invalidated_future_session_ids: invalidated });
});

route("PUT", "/availability/unavailable-periods/:id", (ctx) => {
  const period = findPeriod(ctx.state, ctx.params.id);
  Object.assign(period, parsePeriodDraft(ctx.body));
  const invalidated = invalidateFutureSessions(ctx.state);
  return json(200, { period: periodWire(period), invalidated_future_session_ids: invalidated });
});

route("DELETE", "/availability/unavailable-periods/:id", (ctx) => {
  const period = findPeriod(ctx.state, ctx.params.id);
  if (ctx.query.get("confirmed") !== "true") fail(422, "Removing an unavailable period requires confirmation");
  ctx.state.periods = ctx.state.periods.filter((item) => item.id !== period.id);
  return noContent();
});

route("PUT", "/availability/study-time", (ctx) => {
  const { state } = ctx;
  const body = ctx.body ?? {};
  if (!body.confirm_timezone && !body.planning_preferences && !body.recurring_availability && !body.blocked_periods) {
    fail(422, "Provide at least one study-time change");
  }
  // Validate everything before changing anything, so a bad field leaves state untouched.
  const preferences = body.planning_preferences ? parsePreferences(state, body.planning_preferences) : null;
  if (body.recurring_availability && body.recurring_availability.replace_all !== true) {
    invalidField("replace_all", "Input should be True", "literal_error");
  }
  const windows = body.recurring_availability ? parseWindows(body.recurring_availability.windows) : null;
  const changes = body.blocked_periods ?? {};
  const additions = (changes.add ?? []).map(parsePeriodDraft);
  const updates = (changes.update ?? []).map((item) => ({ period: findPeriod(state, item?.period_id), draft: parsePeriodDraft(item) }));
  const removals = (changes.remove ?? []).map((item) => {
    if (item?.confirmed !== true) fail(422, "Removing an unavailable period requires confirmation");
    return findPeriod(state, item.period_id).id;
  });

  if (body.confirm_timezone) state.preferences.availability_confirmation_required = false;
  if (preferences) state.preferences = preferences;
  if (windows) state.windows = windows;
  const added = additions.map((draft) => ({ id: randomUUID(), importKey: null, ...draft }));
  state.periods.push(...added);
  for (const { period, draft } of updates) Object.assign(period, draft);
  state.periods = state.periods.filter((period) => !removals.includes(period.id));

  return json(200, {
    timezone_confirmed: !state.preferences.availability_confirmation_required,
    planning_preferences: preferences ? state.preferences : null,
    recurring_windows: windows ? windows.map(windowWire) : null,
    added_blocked_periods: added.map(periodWire),
    updated_blocked_periods: updates.map(({ period }) => periodWire(period)),
    removed_blocked_period_ids: removals,
    invalidated_future_session_ids: invalidateFutureSessions(state),
  });
});

// Study sessions
route("GET", "/study-sessions", (ctx) => {
  const boundary = (name) => {
    const value = ctx.query.get(name);
    if (value === null || value === "") return null;
    const parsed = parseAbsolute(value);
    if (parsed === null) fail(422, "Study session time filters must include a UTC offset");
    return parsed;
  };
  const from = boundary("from");
  const to = boundary("to");
  if (from !== null && to !== null && from >= to) fail(422, "from must be earlier than to");
  const taskId = ctx.query.get("task_id");
  const awaitingRaw = ctx.query.get("awaiting_outcome");
  if (awaitingRaw !== null && awaitingRaw !== "true" && awaitingRaw !== "false") {
    fail(422, [{ type: "bool_parsing", loc: ["query", "awaiting_outcome"], msg: "Input should be a valid boolean", input: awaitingRaw }]);
  }
  const awaiting = awaitingRaw === null ? null : awaitingRaw === "true";
  const now = Date.now();
  const isAwaiting = (session) => !session.outcome && session.endsAt <= now;
  return json(
    200,
    [...ctx.state.sessions]
      .filter(
        (session) =>
          (from === null || session.endsAt > from) &&
          (to === null || session.startsAt < to) &&
          (!taskId || session.taskId === taskId) &&
          (awaiting === null || isAwaiting(session) === awaiting),
      )
      .sort((a, b) => a.startsAt - b.startsAt)
      .map((session) => sessionWire(ctx.state, session)),
  );
});

route("GET", "/study-sessions/:id", (ctx) => json(200, sessionWire(ctx.state, findSession(ctx.state, ctx.params.id))));

route("POST", "/study-sessions/:id/outcomes", (ctx) => {
  const { state } = ctx;
  const now = Date.now();
  const session = findSession(state, ctx.params.id);
  const body = ctx.body ?? {};
  const kind = body.outcome;
  if (!["completed", "delayed", "missed"].includes(kind)) {
    fail(422, [{ type: "union_tag_invalid", loc: ["body"], msg: "Input tag does not match 'completed', 'delayed' or 'missed'", input: kind }]);
  }
  if (session.endsAt > now) fail(409, "The study session has not ended");
  const task = findTask(state, session.taskId);

  const repeatMissed =
    kind === "missed" &&
    session.outcome?.kind === "missed" &&
    session.outcome.remaining > 0 &&
    session.outcome.rescheduledAt === null;
  if (session.outcome && !repeatMissed) fail(409, "The study session already has an outcome");

  if (!session.outcome) {
    let actual = 0;
    let remaining = session.planned;
    if (kind !== "missed") {
      actual = body.actual_minutes;
      if (!Number.isInteger(actual) || actual <= 0 || actual > MAX_DURATION_MINUTES) {
        fail(422, "Actual minutes must be a positive integer");
      }
      if (actual > session.planned * LARGE_ACTUAL_FACTOR && body.large_actual_confirmed !== true) {
        fail(422, "Confirm the unusually large actual duration before saving");
      }
      remaining = kind === "completed" ? 0 : (body.remaining_minutes ?? session.planned - actual);
      if (kind === "delayed" && (!Number.isInteger(remaining) || remaining <= 0 || remaining > MAX_DURATION_MINUTES)) {
        fail(422, "Delayed outcomes require positive remaining minutes");
      }
    }
    session.outcome = { kind, actual, remaining, recordedAt: now, rescheduledAt: null };
    task.frozen = true;
    task.updatedAt = now;
  }

  let revision = null;
  if (kind === "completed") {
    if (task.completedAt === null && remainingMinutes(state, task) === 0) {
      task.completedAt = now;
      dropTaskWork(state, task.id);
    }
  } else {
    const reason =
      kind === "missed"
        ? `You missed a session for “${task.title}”. This plan finds new time for that work.`
        : `A session for “${task.title}” ran short. This plan makes room for the ${session.outcome.remaining} minutes left.`;
    state.proposal = planSchedule(state, { kind: "revision", reason });
    revision = proposalWire(state, state.proposal);
  }
  return json(
    201,
    { session: sessionWire(state, session), outcome: outcomeWire(session), revision },
    { Location: `${API_PREFIX}/study-sessions/${session.id}` },
  );
});

// Schedule proposals
route("POST", "/schedule-proposals", (ctx) => {
  const scenario = normaliseScenario(ctx.body?.scenario);
  ctx.state.proposal = planSchedule(ctx.state, { scenario });
  return json(201, proposalWire(ctx.state, ctx.state.proposal));
});

route("POST", "/schedule-proposals/simulate", (ctx) => {
  const scenario = normaliseScenario(ctx.body?.scenario);
  if (!scenario) fail(422, "A scenario is required for simulation");
  return json(200, {
    proposal: proposalWire(ctx.state, planSchedule(ctx.state, { scenario })),
    active_schedule_changed: false,
    requires_user_review: false,
    persisted: false,
  });
});

route("GET", "/schedule-proposals/current", (ctx) => {
  if (!ctx.state.proposal) fail(404, "Schedule proposal not found");
  return json(200, proposalWire(ctx.state, ctx.state.proposal));
});

route("POST", "/schedule-proposals/:id/accept", (ctx) => {
  const { state } = ctx;
  const now = Date.now();
  const proposal = state.proposal;
  if (!proposal || proposal.id !== ctx.params.id) fail(404, "Proposal not found");
  if (proposal.sessions.some((session) => session.startsAt < now - 5 * MINUTE)) {
    fail(409, "The schedule proposal has expired");
  }
  // Unlike the real backend, an Overload proposal is accepted too: the UI
  // offers "Use this plan" and promises to place everything that fits.
  state.sessions = state.sessions.filter((session) => session.outcome !== null || session.startsAt <= now);
  const accepted = proposal.sessions.map((session) => ({ ...session, outcome: null }));
  state.sessions.push(...accepted);
  state.sessions.sort((a, b) => a.startsAt - b.startsAt);
  for (const session of state.sessions) {
    if (session.outcome && session.outcome.kind !== "completed" && session.outcome.rescheduledAt === null) {
      session.outcome.rescheduledAt = now;
    }
  }
  state.proposal = null;
  return json(200, { sessions: accepted.map((session) => proposedSessionWire(state, session)) });
});

route("POST", "/schedule-proposals/:id/reject", (ctx) => {
  if (!ctx.state.proposal || ctx.state.proposal.id !== ctx.params.id) fail(404, "Proposal not found");
  ctx.state.proposal = null;
  return noContent();
});

// Google import. There is no Google consent screen in mock mode; the
// review pages are reachable directly at /import/google/mock-calendar and
// /import/google/mock-classroom.
route("GET", "/integrations/google/status", (ctx) =>
  json(200, {
    configured: true,
    calendar_checked_at: ctx.state.google.calendarCheckedAt === null ? null : iso(ctx.state.google.calendarCheckedAt),
    classroom_checked_at: ctx.state.google.classroomCheckedAt === null ? null : iso(ctx.state.google.classroomCheckedAt),
  }),
);

const importUnavailable = (id) => () =>
  fail(503, `Google is not reachable in UI mock mode. Open /import/google/${id} to review a sample import instead.`);
route("POST", "/integrations/google/calendar/start", importUnavailable(CALENDAR_IMPORT_ID));
route("POST", "/integrations/google/classroom/start", importUnavailable(CLASSROOM_IMPORT_ID));

route("GET", "/integrations/google/imports/:id", (ctx) => {
  const { state } = ctx;
  if (ctx.params.id === CALENDAR_IMPORT_ID) {
    state.google.calendarCheckedAt = Date.now();
    return json(200, calendarImportWire(state));
  }
  if (ctx.params.id === CLASSROOM_IMPORT_ID) {
    state.google.classroomCheckedAt = Date.now();
    return json(200, classroomImportWire(state));
  }
  return fail(404, "Import not found or expired");
});

route("POST", "/integrations/google/imports/:id/calendar", (ctx) => {
  const { state } = ctx;
  if (ctx.params.id !== CALENDAR_IMPORT_ID) fail(404, "Import not found or expired");
  const selected = new Set(Array.isArray(ctx.body?.item_ids) ? ctx.body.item_ids : []);
  const now = Date.now();
  const result = { created: 0, updated: 0, unchanged: 0, skipped_past: 0 };
  for (const item of calendarImportItems(now, state.preferences.timezone)) {
    if (!selected.has(item.id)) continue;
    if (item.endsAt <= now) {
      result.skipped_past += 1;
      continue;
    }
    const existing = state.periods.find((period) => period.importKey === item.id);
    if (!existing) {
      state.periods.push({ id: randomUUID(), startsAt: item.startsAt, endsAt: item.endsAt, reason: item.title, importKey: item.id });
      result.created += 1;
    } else if (existing.startsAt !== item.startsAt || existing.endsAt !== item.endsAt) {
      Object.assign(existing, { startsAt: item.startsAt, endsAt: item.endsAt, reason: item.title });
      result.updated += 1;
    } else {
      result.unchanged += 1;
    }
  }
  return json(200, { ...result, invalidated_future_session_ids: invalidateFutureSessions(state) });
});

route("POST", "/integrations/google/imports/:id/classroom", (ctx) => {
  const { state } = ctx;
  if (ctx.params.id !== CLASSROOM_IMPORT_ID) fail(404, "Import not found or expired");
  const now = Date.now();
  const available = new Map(classroomImportItems(now, state.preferences.timezone).map((item) => [item.id, item]));
  const result = { created_task_ids: [], already_imported: [], failed: [] };
  for (const selection of Array.isArray(ctx.body?.items) ? ctx.body.items : []) {
    const item = available.get(selection?.id);
    if (!item || !CATEGORIES.includes(selection.category) || !PRIORITIES.includes(selection.priority) ||
        !Number.isInteger(selection.estimate_minutes) || selection.estimate_minutes < 1) {
      result.failed.push({ id: String(selection?.id), reason: "invalid" });
      continue;
    }
    if (state.tasks.some((task) => task.importedFrom === item.id)) {
      result.already_imported.push(item.id);
      continue;
    }
    if (item.dueAt <= now) {
      result.failed.push({ id: item.id, reason: "deadline_passed" });
      continue;
    }
    const task = {
      id: randomUUID(),
      title: item.title,
      category: selection.category,
      priority: selection.priority,
      course: item.course,
      notes: item.link ? `Imported from Google Classroom: ${item.link}` : "Imported from Google Classroom",
      deadline: item.dueAt,
      original: selection.estimate_minutes,
      adaptive: null,
      plannedSource: "original",
      planned: selection.estimate_minutes,
      frozen: false,
      completedAt: null,
      importedFrom: item.id,
      createdAt: now,
      updatedAt: now,
    };
    state.tasks.push(task);
    result.created_task_ids.push(task.id);
  }
  return json(200, result);
});

route("DELETE", "/integrations/google/imports/:id", (ctx) => {
  if (![CALENDAR_IMPORT_ID, CLASSROOM_IMPORT_ID].includes(ctx.params.id)) fail(404, "Import not found or expired");
  return noContent();
});

// ─── HTTP plumbing ───────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res, { status, body, headers }) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "Cache-Control": "no-store",
    ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    ...headers,
  });
  res.end(payload);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Starts the mock API. Resolves once it is listening.
 *
 * Listens on 127.0.0.1 by default; point BACKEND_ORIGIN at 127.0.0.1 rather
 * than `localhost`, which Node may resolve to ::1 first.
 *
 * @param {{ port?: number, host?: string, latencyMs?: number, verbose?: boolean, log?: (line: string) => void }} [options]
 */
export function startMockApi(options = {}) {
  const port = options.port ?? Number(process.env.MOCK_API_PORT ?? 8010);
  const host = options.host ?? "127.0.0.1";
  const latencyMs = options.latencyMs ?? Number(process.env.MOCK_API_LATENCY_MS ?? 120);
  const log = options.log ?? ((line) => console.log(line));
  const accounts = new Map();
  for (const create of ACCOUNT_FACTORIES) {
    const seeded = create();
    accounts.set(seeded.account.email, { create, state: seeded });
  }
  const [demo] = accounts.values();
  let state = demo.state;
  const switchAccount = (ctx, email) => {
    const entry = accounts.get(String(email).trim().toLowerCase()) ?? demo;
    state = entry.state;
    ctx.state = state;
  };
  const resetAccount = () => {
    const entry = [...accounts.values()].find((item) => item.state === state);
    entry.state = { ...entry.create(), signedIn: false };
    state = entry.state;
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://mock.local");
    const method = (req.method ?? "GET").toUpperCase();
    let result;
    try {
      const raw = await readBody(req);
      if (latencyMs > 0) await sleep(latencyMs);
      if (!url.pathname.startsWith(`${API_PREFIX}/`)) fail(404, "Not Found");
      const apiPath = url.pathname.slice(API_PREFIX.length).replace(/\/+$/, "") || "/";
      const candidates = routes.filter((item) => item.regex.test(apiPath));
      const match = candidates.find((item) => item.method === method);
      if (!match) {
        log(`[mock-api] unhandled ${method} ${url.pathname}${url.search}`);
        if (candidates.length > 0) throw new HttpError(405, "Method Not Allowed");
        fail(404, "Not Found");
      }
      if (!match.public && !state.signedIn) fail(401, "Not authenticated");
      let body;
      if (raw.trim()) {
        try {
          body = JSON.parse(raw);
        } catch {
          fail(422, [{ type: "json_invalid", loc: ["body", 0], msg: "JSON decode error", input: {} }]);
        }
      }
      const values = apiPath.match(match.regex).slice(1).map(decodeURIComponent);
      const params = Object.fromEntries(match.keys.map((key, index) => [key, values[index]]));
      const ctx = { state, params, query: url.searchParams, body, resetAccount };
      ctx.switchAccount = (email) => switchAccount(ctx, email);
      result = await match.handler(ctx);
    } catch (error) {
      if (error instanceof HttpError) {
        result = json(error.status, { detail: error.detail }, error.headers);
      } else {
        log(`[mock-api] error on ${method} ${url.pathname}: ${error?.stack ?? error}`);
        result = json(500, { detail: "Mock API error" });
      }
    }
    send(res, result);
    if (options.verbose ?? process.env.MOCK_API_VERBOSE === "1") {
      log(`[mock-api] ${method} ${url.pathname}${url.search} -> ${result.status}`);
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      resolve({
        server,
        port: actualPort,
        url: `http://${host.includes(":") ? `[${host}]` : host}:${actualPort}`,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}

export function listMockRoutes() {
  return routes.map((item) => `${item.method} ${API_PREFIX}${item.pattern}`);
}

const samePath = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
const isMain = Boolean(process.argv[1]) && samePath(fileURLToPath(import.meta.url), path.resolve(process.argv[1]));
if (isMain) {
  const api = await startMockApi();
  console.log(`[mock-api] StudyFlow mock API on ${api.url}${API_PREFIX} (in-memory demo data, resets on restart)`);
  const stop = () => {
    void api.close().then(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
