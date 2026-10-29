import { delay, http, HttpResponse } from "msw";
import { account, preferences, wireTask, wireSessions, wireWindows, wirePeriod, wireProposal, NOW } from "./fixtures";
import type { WireAcademicTask, WireStudySession } from "@/lib/api/wire";

export interface ApiScenario {
  state?: "ready" | "empty" | "loading" | "error";
  authenticated?: boolean;
  pending?: boolean;
  adaptive?: boolean;
  overloaded?: boolean;
  googleConfigured?: boolean;
}
let scenario: ApiScenario = {};
let tasks: WireAcademicTask[] = [];
let sessions: WireStudySession[] = [];
let windows = structuredClone(wireWindows);
let periods = [structuredClone(wirePeriod)];
let profile = { ...account };
let prefs = { ...preferences };
let pending = false;
let sequence = 0;
export const requests: { method: string; path: string; body: Record<string, unknown> }[] = [];
export const unhandledRequests: string[] = [];

export function resetApi(next: ApiScenario = {}) {
  scenario = { ...next };
  tasks = next.state === "empty" ? [] : [{ ...wireTask, ...(next.overloaded ? { planned_duration_minutes: 4000, original_estimate_minutes: 4000 } : {}) }];
  sessions = next.state === "empty" ? [] : structuredClone(wireSessions);
  windows = next.state === "empty" ? [] : structuredClone(wireWindows);
  periods = next.state === "empty" ? [] : [structuredClone(wirePeriod)];
  profile = { ...account };
  prefs = { ...preferences };
  pending = next.pending ?? false;
  sequence = 0;
  requests.length = 0;
  unhandledRequests.length = 0;
}

const json = (value: unknown, status = 200) => HttpResponse.json(value as never, { status });
const empty = () => new HttpResponse(null, { status: 204 });

export const apiHandler = http.all("/api/v1/*", async ({ request }) => {
  const url = new URL(request.url);
  const path = url.pathname.replace("/api/v1", "");
  const method = request.method;
  const body = method === "GET" || method === "DELETE" ? {} : await request.json().catch(() => ({})) as Record<string, unknown>;
  requests.push({ method, path, body });
  if (path === "/auth/session") return scenario.authenticated === false ? json({ detail: "Not authenticated" }, 401) : json({ account: profile });
  if (path === "/account/preferences") {
    if (method === "PATCH") prefs = { ...prefs, ...body };
    return json(prefs);
  }
  if (scenario.state === "loading") await delay("infinite");
  if (scenario.state === "error") return json({ detail: "Storybook demo: service temporarily unavailable" }, 503);
  if (path === "/auth/login" || path === "/auth/google/link/browser") {
    scenario.authenticated = true;
    return json({ account: profile, csrf_token: "storybook" });
  }
  if (path === "/auth/logout") { scenario.authenticated = false; return empty(); }
  if (path === "/auth/verify-email") return json({ signup_token: "storybook-signup" });
  if (path.startsWith("/auth/google/")) return json({ detail: "OAuth navigation is unavailable in this isolated demo." }, 400);
  if (path.startsWith("/auth/")) return json({ message: "Check your email for the next step." });
  if (path === "/account/profile") {
    if (method === "PATCH") profile = { ...profile, ...body };
    return json(profile);
  }
  if (path === "/account/identities") return json([{ provider: "google", email: account.email, linked_at: NOW }]);
  if (path === "/account/deletion/status") return json({ ready: false });
  if (path.startsWith("/account/")) return empty();
  if (path === "/tasks" && method === "GET") {
    return json(tasks.filter((t) => (!url.searchParams.get("query") || t.title.toLowerCase().includes(url.searchParams.get("query")!.toLowerCase())) && (!url.searchParams.get("status") || t.status === url.searchParams.get("status"))));
  }
  if (path === "/tasks" && method === "POST") {
    const created = { ...wireTask, ...body, id: `task-${++sequence}`, adaptive_estimate_minutes: null, planned_duration_minutes: body.original_estimate_minutes, planned_source: "original" } as WireAcademicTask;
    tasks.push(created);
    return json(created, 201);
  }
  if (path.startsWith("/tasks/")) {
    const task = tasks.find((t) => t.id === path.split("/")[2]);
    if (!task) return json({ detail: "Task not found" }, 404);
    if (method === "DELETE") { tasks = tasks.filter((t) => t !== task); return empty(); }
    if (method === "PUT") Object.assign(task, body, { updated_at: NOW });
    if (path.endsWith("/start")) task.status = "in_progress";
    if (path.endsWith("/finish-early")) task.status = "completed";
    return json(task);
  }
  if (path === "/progress") return json(tasks.map((t) => ({ task_id: t.id, task_title: t.title, actual_duration_minutes: 30, estimated_remaining_minutes: scenario.overloaded ? 4000 : 120, effort_percent: scenario.overloaded ? 1 : 20, sessions_completed: 0, sessions_upcoming: 1, status: t.status })));
  if (path === "/adaptive-estimates/preview") {
    const original = Number(url.searchParams.get("original_minutes") ?? 60);
    const adaptive = scenario.adaptive ?? true;
    return json({ category: url.searchParams.get("category") ?? "reading", original_minutes: original, adaptive_minutes: adaptive ? original * 1.25 : null, planned_minutes: adaptive ? original * 1.25 : original, correction_factor: adaptive ? "1.25" : null, history_scope: adaptive ? "category" : null, history_count: adaptive ? 6 : null, available: adaptive, planned_source: adaptive ? "adaptive" : "original", acknowledgment_required: false });
  }
  if (path === "/adaptive-estimates/acknowledgments") return empty();
  if (path === "/availability/windows") {
    if (method === "PUT") windows = (body.windows as typeof windows).map((w, i) => ({ ...w, id: `window-${i}` }));
    return json(method === "GET" ? windows : { windows, invalidated_future_session_ids: [] });
  }
  if (path === "/availability/unavailable-periods") {
    if (method === "GET") return json(periods);
    const period = { ...wirePeriod, ...body, id: `period-${++sequence}` };
    periods.push(period);
    return json({ period, invalidated_future_session_ids: [] }, 201);
  }
  if (path.startsWith("/availability/unavailable-periods/")) {
    const id = path.split("/").at(-1);
    if (method === "DELETE") { periods = periods.filter((p) => p.id !== id); return empty(); }
    const period = periods.find((p) => p.id === id);
    Object.assign(period ?? {}, body);
    return json({ period, invalidated_future_session_ids: [] });
  }
  if (path === "/availability/confirm-timezone") return empty();
  if (path === "/availability/study-time") {
    const input = (body.recurring_availability as { windows: typeof windows } | undefined)?.windows;
    if (input) windows = input.map((w, i) => ({ ...w, id: `window-${i}` }));
    if (body.planning_preferences) prefs = { ...prefs, ...body.planning_preferences };
    const changes = body.blocked_periods as { add?: typeof periods; update?: ((typeof periods)[number] & { period_id: string })[]; remove?: { period_id: string }[] } | undefined;
    const added = (changes?.add ?? []).map((p) => ({ ...p, id: `period-${++sequence}` }));
    periods = periods.filter((p) => !changes?.remove?.some((r) => r.period_id === p.id));
    const updated = (changes?.update ?? []).map((p) => ({ ...p, id: p.period_id }));
    updated.forEach((p) => Object.assign(periods.find((row) => row.id === p.id) ?? {}, p));
    periods.push(...added);
    return json({ timezone_confirmed: true, planning_preferences: prefs, recurring_windows: windows, added_blocked_periods: added, updated_blocked_periods: updated, removed_blocked_period_ids: changes?.remove?.map((p) => p.period_id) ?? [], invalidated_future_session_ids: [] });
  }
  if (path === "/study-sessions") return json(sessions);
  if (path.endsWith("/outcomes")) {
    const session = sessions.find((s) => s.id === path.split("/")[2]);
    if (!session) return json({ detail: "Session not found" }, 404);
    const outcome = { session_id: session.id, kind: body.outcome, actual_minutes: body.actual_minutes ?? 0, remaining_minutes: body.outcome === "missed" ? session.planned_duration_minutes : body.remaining_minutes ?? 0, recorded_at: NOW, rescheduled_at: null } as NonNullable<WireStudySession["outcome"]>;
    session.outcome = outcome;
    pending = outcome.kind !== "completed";
    return json({ session, outcome, revision: pending ? { ...wireProposal, kind: "revision", revision_reason: "Session outcome changed remaining work." } : null });
  }
  if (path === "/schedule-proposals/current") return pending ? json(wireProposal) : json({ detail: "No pending proposal" }, 404);
  if (path === "/schedule-proposals") { pending = true; return json(wireProposal); }
  if (path.endsWith("/accept")) { sessions = [structuredClone(wireSessions[1])]; pending = false; return empty(); }
  if (path.endsWith("/reject")) { pending = false; return empty(); }
  if (path === "/integrations/google/status") return json({ configured: scenario.googleConfigured ?? true, calendar_checked_at: "2026-10-01T05:00:00Z", classroom_checked_at: "2026-10-01T05:00:00Z" });
  if (/^\/integrations\/google\/(calendar|classroom)\/start$/.test(path)) return json({ detail: "OAuth navigation is unavailable in this isolated demo." }, 400);
  if (path.startsWith("/integrations/google/imports/")) {
    const id = path.split("/")[4];
    if (method === "DELETE") return empty();
    if (method === "POST" && path.endsWith("/calendar")) return json({ created: (body.item_ids as string[]).length, updated: 0, unchanged: 0, skipped_past: 0, invalidated_future_session_ids: [] });
    if (method === "POST" && path.endsWith("/classroom")) return json({ created_task_ids: ["imported-task"], already_imported: [], failed: [] });
    return json({ id, source: id === "import-classroom" ? "google_classroom" : "google_calendar", expires_at: "2026-10-16T06:00:00Z", items: scenario.state === "empty" ? [] : id === "import-classroom" ? [
      { id: "assignment", title: "Lab report", course: "Physics", due_at: wireTask.deadline_at, link: null, suggested_category: "assignment", status: "new" },
      { id: "imported", title: "Reading quiz", course: "PSY101", due_at: wireTask.deadline_at, link: null, suggested_category: "reading", status: "already_imported" },
    ] : [
      { id: "shift", title: "Part-time shift", starts_at: wirePeriod.starts_at, ends_at: wirePeriod.ends_at, all_day: false, status: "new" },
      { id: "trip", title: "Family trip", starts_at: "2026-10-19T00:00:00Z", ends_at: "2026-10-20T00:00:00Z", all_day: true, status: "changed" },
    ] });
  }
  unhandledRequests.push(`${method} ${path}`);
  return json({ detail: `Unhandled Storybook request: ${method} ${path}` }, 501);
});
