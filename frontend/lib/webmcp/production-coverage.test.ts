import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listTasks: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  startTask: vi.fn(),
  finishTaskEarly: vi.fn(),
  deleteTask: vi.fn(),
  getTask: vi.fn(),
  listWindows: vi.fn(),
  listUnavailablePeriods: vi.fn(),
  replaceWindows: vi.fn(),
  updateStudyTime: vi.fn(),
  updatePreferences: vi.fn(),
  getPreferences: vi.fn(),
  getActiveSchedule: vi.fn(),
  getPendingRevision: vi.fn(),
  listEffortProgress: vi.fn(),
  simulatePlan: vi.fn(),
  generateProposal: vi.fn(),
  acceptProposal: vi.fn(),
  rejectProposal: vi.fn(),
  recordOutcome: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  account: {
    getPreferences: mocks.getPreferences,
    updatePreferences: mocks.updatePreferences,
  },
  availability: {
    listWindows: mocks.listWindows,
    listUnavailablePeriods: mocks.listUnavailablePeriods,
    replaceWindows: mocks.replaceWindows,
    updateStudyTime: mocks.updateStudyTime,
  },
  scheduling: {
    getActiveSchedule: mocks.getActiveSchedule,
    getPendingRevision: mocks.getPendingRevision,
    listEffortProgress: mocks.listEffortProgress,
    simulatePlan: mocks.simulatePlan,
    generateProposal: mocks.generateProposal,
    acceptProposal: mocks.acceptProposal,
    rejectProposal: mocks.rejectProposal,
    recordOutcome: mocks.recordOutcome,
  },
  tasks: {
    listTasks: mocks.listTasks,
    createTask: mocks.createTask,
    updateTask: mocks.updateTask,
    startTask: mocks.startTask,
    finishTaskEarly: mocks.finishTaskEarly,
    deleteTask: mocks.deleteTask,
    getTask: mocks.getTask,
  },
}));

import { WEBMCP_TOOL_NAMES } from "./contracts";
import { startStudyFlowWebMcp } from "./register";
import { createStudyFlowTools } from "./tools";
import { getWebMcpModelContext, signalFor } from "./types";

const task = {
  id: "task-1",
  title: "Read",
  category: "Reading",
  priority: "Medium",
  status: "Not Started",
  deadline: "2026-10-10T12:00:00Z",
  originalEstimate: 90,
  remainingDuration: 90,
} as any;

const preferences = {
  timezone: "Asia/Phnom_Penh",
  preferred_session_length_minutes: 45,
  minimum_break_minutes: 5,
  availability_confirmation_required: false,
} as any;

const windows = [{
  id: "window-1",
  dayOfWeek: 1,
  startTime: "09:00",
  endTime: "11:00",
}] as any;

const periods = [] as any;
const schedule = { sessions: [{ id: "session-1", taskId: task.id }] } as any;
const signal = new AbortController().signal;

function tool(name: string) {
  const found = createStudyFlowTools().find((item) => item.name === name);
  if (!found) throw new Error(`Missing tool ${name}`);
  return found;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listTasks.mockResolvedValue([task]);
  mocks.listWindows.mockResolvedValue(windows);
  mocks.listUnavailablePeriods.mockResolvedValue(periods);
  mocks.getPreferences.mockResolvedValue(preferences);
  mocks.getActiveSchedule.mockResolvedValue(schedule);
  mocks.getPendingRevision.mockResolvedValue(null);
  mocks.listEffortProgress.mockResolvedValue([]);
  mocks.createTask.mockResolvedValue(task);
  mocks.updateTask.mockResolvedValue(task);
  mocks.getTask.mockResolvedValue(task);
  mocks.updateStudyTime.mockResolvedValue({ invalidated_future_session_ids: [] });
  mocks.simulatePlan.mockResolvedValue({ feasible: true });
  mocks.generateProposal.mockResolvedValue({ id: "proposal-1" });
  mocks.acceptProposal.mockResolvedValue(schedule);
  mocks.recordOutcome.mockResolvedValue({ session: { id: "session-1" }, revision: null });
});

afterEach(() => {
  delete document.modelContext;
  delete navigator.modelContext;
});

describe("WebMCP contracts and registration", () => {
  it("exposes stable names, context fallbacks, and abort signals", () => {
    expect(Object.keys(WEBMCP_TOOL_NAMES)).toHaveLength(9);
    expect(signalFor({ signal })).toBe(signal);
    expect(signalFor()).toBeInstanceOf(AbortSignal);
    expect(getWebMcpModelContext()).toBeNull();
    expect(startStudyFlowWebMcp()).toBeNull();

    const context = { registerTool: vi.fn() };
    navigator.modelContext = context;
    expect(getWebMcpModelContext()).toBe(context);
    document.modelContext = context;
    expect(getWebMcpModelContext()).toBe(context);

    const savedDocument = document;
    vi.stubGlobal("document", undefined);
    expect(getWebMcpModelContext()).toBeNull();
    vi.stubGlobal("document", savedDocument);
  });

  it("registers every tool and aborts on dispose", async () => {
    const context = { registerTool: vi.fn() };
    document.modelContext = context;
    const registration = startStudyFlowWebMcp();
    expect(registration).not.toBeNull();
    await registration!.ready;
    expect(context.registerTool).toHaveBeenCalledTimes(9);
    registration!.dispose();
    const options = context.registerTool.mock.calls[0][1];
    expect(options.signal.aborted).toBe(true);
  });
});

describe("WebMCP tools", () => {
  it("reads plan state for each supported horizon and setup status", async () => {
    for (const horizon of [7, 14, 30]) {
      const result = await tool(WEBMCP_TOOL_NAMES.getPlanState).execute({ horizon_days: horizon }, { signal });
      expect((result as any).data.capacity.horizon_days).toBe(horizon);
    }
    mocks.getPreferences.mockResolvedValue({ ...preferences, availability_confirmation_required: true });
    expect((await tool(WEBMCP_TOOL_NAMES.getPlanState).execute({}, { signal }) as any).data.setup_status).toBe("needs_timezone_confirmation");
    mocks.getPreferences.mockResolvedValue(preferences);
    mocks.listWindows.mockResolvedValue([]);
    expect((await tool(WEBMCP_TOOL_NAMES.getPlanState).execute({}, { signal }) as any).data.setup_status).toBe("needs_availability");
    mocks.listWindows.mockResolvedValue(windows);
    mocks.listTasks.mockResolvedValue([{ ...task, status: "Completed", remainingDuration: 0 }]);
    expect((await tool(WEBMCP_TOOL_NAMES.getPlanState).execute({}, { signal }) as any).data.setup_status).toBe("needs_tasks");
    await expect(tool(WEBMCP_TOOL_NAMES.getPlanState).execute({ horizon_days: 8 }, { signal })).rejects.toThrow("horizon_days");
  });

  it("adds a task and updates study time through every input shape", async () => {
    const addResult = await tool(WEBMCP_TOOL_NAMES.addTask).execute({
      title: " Essay ", category: "Research/Writing", priority: "High",
      course: "Course", notes: "Notes", deadline_at: "2026-10-10T12:00:00Z", original_estimate_minutes: 120,
    }, { signal });
    expect((addResult as any).data.task).toBe(task);
    expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({ title: "Essay", originalEstimate: 120 }), signal);

    await tool(WEBMCP_TOOL_NAMES.addTask).execute({
      title: "No optional text", category: "Reading", priority: "Low",
      deadline_at: "2026-10-10T12:00:00Z", original_estimate_minutes: 30,
      course: "   ", notes: null,
    }, { signal });
    expect(mocks.createTask).toHaveBeenLastCalledWith(expect.objectContaining({ course: undefined, notes: undefined }), signal);

    await tool(WEBMCP_TOOL_NAMES.updateStudyTime).execute({ confirm_timezone: true }, { signal });
    await tool(WEBMCP_TOOL_NAMES.updateStudyTime).execute({
      planning_preferences: { timezone: "UTC", preferred_session_length_minutes: 50, minimum_break_minutes: 10 },
    }, { signal });
    await tool(WEBMCP_TOOL_NAMES.updateStudyTime).execute({
      recurring_availability: { replace_all: true, windows: [{ day: "Monday", start_time: "09:00", end_time: "10:00" }] },
    }, { signal });
    await tool(WEBMCP_TOOL_NAMES.updateStudyTime).execute({
      blocked_periods: {
        add: [{ starts_at: "2026-10-01T09:00:00Z", ends_at: "2026-10-01T10:00:00Z", reason: "   " }],
        update: [{ period_id: "period-1", starts_at: "2026-10-02T09:00:00Z", ends_at: "2026-10-02T10:00:00Z", reason: null }],
        remove: [{ period_id: "period-2", confirmed: true }],
      },
    }, { signal });
    expect(mocks.updateStudyTime).toHaveBeenCalledTimes(4);
    expect((await tool(WEBMCP_TOOL_NAMES.updateStudyTime).execute({ planning_preferences: { timezone: "UTC", preferred_session_length_minutes: 50, minimum_break_minutes: 10 } }, { signal }) as any).requires_user_review).toBe(true);
    mocks.updateStudyTime.mockResolvedValue({ invalidated_future_session_ids: ["session-1"] });
    expect((await tool(WEBMCP_TOOL_NAMES.updateStudyTime).execute({ confirm_timezone: true }, { signal }) as any).active_schedule_changed).toBe(true);
  });

  it("validates study-time and task input errors", async () => {
    const update = tool(WEBMCP_TOOL_NAMES.updateStudyTime);
    await expect(update.execute({}, { signal })).rejects.toThrow("at least one");
    await expect(update.execute({ confirm_timezone: false }, { signal })).rejects.toThrow("confirm_timezone");
    await expect(update.execute({ planning_preferences: { timezone: "UTC", preferred_session_length_minutes: 9, minimum_break_minutes: 0 } }, { signal })).rejects.toThrow("preferred_session");
    await expect(update.execute({ planning_preferences: { timezone: "UTC", preferred_session_length_minutes: 20, minimum_break_minutes: 121 } }, { signal })).rejects.toThrow("minimum_break");
    await expect(update.execute({ recurring_availability: { replace_all: false, windows: [] } }, { signal })).rejects.toThrow("replace_all");
    await expect(update.execute({ recurring_availability: { replace_all: true, windows: [{ day: "Funday", start_time: "09:00", end_time: "10:00" }] } }, { signal })).rejects.toThrow("weekday");
    await expect(update.execute({ recurring_availability: { replace_all: true, windows: [{ day: "Monday", start_time: "bad", end_time: "10:00" }] } }, { signal })).rejects.toThrow("HH:mm");
    await expect(update.execute({ blocked_periods: { add: [] } }, { signal })).rejects.toThrow("at least one");
    await expect(update.execute({ blocked_periods: { remove: [{ period_id: "p", confirmed: false }] } }, { signal })).rejects.toThrow("confirmed");
    await expect(update.execute({ blocked_periods: "bad" }, { signal })).rejects.toThrow("object");
    await expect(update.execute({ blocked_periods: { add: [{ starts_at: "x", ends_at: "y", reason: 1 }] } }, { signal })).rejects.toThrow("reason");
    await expect(update.execute({ blocked_periods: { add: "bad" } }, { signal })).rejects.toThrow("add must be an array");

    const add = tool(WEBMCP_TOOL_NAMES.addTask);
    await expect(add.execute(null, { signal })).rejects.toThrow("object");
    await expect(add.execute({ title: "x", category: "Bad", priority: "Low", deadline_at: "x", original_estimate_minutes: 1 }, { signal })).rejects.toThrow("category");
    await expect(add.execute({ title: "x", category: "Reading", priority: "Bad", deadline_at: "x", original_estimate_minutes: 1 }, { signal })).rejects.toThrow("priority");
    await expect(add.execute({ title: "x", category: "Reading", priority: "Low", deadline_at: "x", original_estimate_minutes: 0 }, { signal })).rejects.toThrow("original_estimate");
    await expect(add.execute({ title: "x", category: "Reading", priority: "Low", deadline_at: "x", original_estimate_minutes: 1, course: 3 }, { signal })).rejects.toThrow("course");
  });

  it("manages tasks through edit, start, finish, and delete", async () => {
    const update = tool(WEBMCP_TOOL_NAMES.updateTask);
    mocks.getActiveSchedule.mockResolvedValueOnce(schedule).mockResolvedValueOnce({ sessions: [{ id: "session-2" }] });
    const edit = await update.execute({ operation: "edit", task_id: "task-1", title: "Read", category: "Reading", priority: "Medium", deadline_at: task.deadline, original_estimate_minutes: 90 }, { signal }) as any;
    expect(edit.data.invalidated_future_session_ids).toEqual(["session-1"]);
    mocks.getActiveSchedule.mockResolvedValueOnce(schedule).mockResolvedValueOnce(null);
    const editWithoutAfterSchedule = await update.execute({ operation: "edit", task_id: "task-1", title: "Read", category: "Reading", priority: "Medium", deadline_at: task.deadline, original_estimate_minutes: 90 }, { signal }) as any;
    expect(editWithoutAfterSchedule.data.invalidated_future_session_ids).toEqual(["session-1"]);
    mocks.getActiveSchedule.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const editWithoutSchedules = await update.execute({ operation: "edit", task_id: "task-1", title: "Read", category: "Reading", priority: "Medium", deadline_at: task.deadline, original_estimate_minutes: 90 }, { signal }) as any;
    expect(editWithoutSchedules.data.invalidated_future_session_ids).toEqual([]);
    await update.execute({ operation: "start", task_id: "task-1" }, { signal });
    await expect(update.execute({ operation: "finish_early", task_id: "task-1" }, { signal })).rejects.toThrow("confirmed");
    await update.execute({ operation: "finish_early", task_id: "task-1", confirmed: true }, { signal });
    await expect(update.execute({ operation: "delete", task_id: "task-1" }, { signal })).rejects.toThrow("confirmed");
    await update.execute({ operation: "delete", task_id: "task-1", confirmed: true }, { signal });
    await expect(update.execute({ operation: "unknown", task_id: "task-1" }, { signal })).rejects.toThrow("operation");
    await expect(update.execute({ operation: "start" }, { signal })).rejects.toThrow("task_id");
  });

  it("simulates, drafts, accepts, rejects, and records missed sessions", async () => {
    const scenario = { temporary_availability: [{ starts_at: "2026-10-01T09:00:00Z", ends_at: "2026-10-01T10:00:00Z" }] };
    await tool(WEBMCP_TOOL_NAMES.simulatePlan).execute({ scenario }, { signal });
    await expect(tool(WEBMCP_TOOL_NAMES.simulatePlan).execute({}, { signal })).rejects.toThrow("scenario");
    await expect(tool(WEBMCP_TOOL_NAMES.simulatePlan).execute({ scenario: [] }, { signal })).rejects.toThrow("scenario must be an object");
    await tool(WEBMCP_TOOL_NAMES.draftPlan).execute({}, { signal });
    await tool(WEBMCP_TOOL_NAMES.draftPlan).execute({ scenario }, { signal });
    await tool(WEBMCP_TOOL_NAMES.acceptPlan).execute({ proposal_id: "proposal-1" }, { signal });
    await tool(WEBMCP_TOOL_NAMES.rejectPlan).execute({ proposal_id: "proposal-1" }, { signal });
    await tool(WEBMCP_TOOL_NAMES.recordMissed).execute({ session_id: "session-1" }, { signal });
    mocks.recordOutcome.mockResolvedValue({ session: { id: "session-2" }, revision: { id: "revision-1" } });
    expect((await tool(WEBMCP_TOOL_NAMES.recordMissed).execute({ session_id: "session-2" }, { signal }) as any).requires_user_review).toBe(true);
    await expect(tool(WEBMCP_TOOL_NAMES.acceptPlan).execute({}, { signal })).rejects.toThrow("proposal_id");
    await expect(tool(WEBMCP_TOOL_NAMES.rejectPlan).execute({ proposal_id: " " }, { signal })).rejects.toThrow("proposal_id");
  });
});
