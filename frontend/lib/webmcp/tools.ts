import { account, availability, scheduling, tasks } from "@/lib/api";
import { assessCapacity } from "@/lib/capacity";
import { notifyStudyFlowDataChanged } from "@/lib/data-events";
import { toEffortProgress } from "@/lib/api/mappers";
import { CATEGORIES, PRIORITIES } from "@/types";
import type { UnavailablePeriodDraft, WindowDraft } from "@/lib/api/availability";
import type { AcademicTask, Category, Priority, TaskFormData } from "@/types/task";
import type {
  PlanningPreferences,
  ScenarioOverrides,
  StudyTimeUpdateResult,
  TaskOperation,
  UpdateTaskResult,
  WebMcpResult,
} from "./contracts";
import { WEBMCP_TOOL_NAMES } from "./contracts";
import {
  addTaskSchema,
  getPlanStateSchema,
  proposalIdSchema,
  scenarioInputSchema,
  sessionIdSchema,
  updateStudyTimeSchema,
  updateTaskSchema,
} from "./schemas";
import type { WebMcpTool } from "./types";
import { signalFor } from "./types";

type InputObject = Record<string, unknown>;

function inputObject(input: unknown): InputObject {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Tool input must be an object.");
  }
  return input as InputObject;
}

function requiredString(input: InputObject, name: string): string {
  const value = input[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
}

function optionalString(input: InputObject, name: string): string | undefined {
  const value = input[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${name} must be a string or null.`);
  return value.trim() || undefined;
}

function horizonDays(input: unknown): 7 | 14 | 30 {
  const value = inputObject(input).horizon_days ?? 7;
  if (value !== 7 && value !== 14 && value !== 30) {
    throw new Error("horizon_days must be 7, 14, or 30.");
  }
  return value;
}

function scenarioInput(input: unknown, required: boolean): ScenarioOverrides | undefined {
  const record = inputObject(input);
  const value = record.scenario;
  if (value === undefined || value === null) {
    if (required) throw new Error("scenario is required.");
    return undefined;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("scenario must be an object.");
  }
  return value as ScenarioOverrides;
}

function idInput(input: unknown, name: "proposal_id" | "session_id"): string {
  return requiredString(inputObject(input), name);
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
type WeekdayName = (typeof WEEKDAYS)[number];
const CLOCK_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function clockTimeInput(value: unknown, name: string): string {
  if (typeof value !== "string" || !CLOCK_TIME.test(value)) {
    throw new Error(`${name} must be a 24-hour HH:mm time.`);
  }
  return value;
}

function weekdayInput(value: unknown): number {
  if (typeof value !== "string" || !WEEKDAYS.includes(value as WeekdayName)) {
    throw new Error("day must be a weekday name such as Monday.");
  }
  return WEEKDAYS.indexOf(value as WeekdayName);
}

function optionalReason(input: InputObject): string | undefined {
  const value = input.reason;
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error("reason must be a string or null.");
  return value.trim() || undefined;
}

function arrayInput(input: InputObject, name: string): unknown[] {
  const value = input[name];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${name} must be an array.`);
  return value;
}

function recurringWindowInputs(input: InputObject): WindowDraft[] | undefined {
  if (input.recurring_availability === undefined) return undefined;
  const availabilityInput = inputObject(input.recurring_availability);
  if (availabilityInput.replace_all !== true) {
    throw new Error("recurring_availability.replace_all must be true.");
  }
  return arrayInput(availabilityInput, "windows").map((item, index) => {
    const window = inputObject(item);
    return {
      dayOfWeek: weekdayInput(window.day),
      startTime: clockTimeInput(window.start_time, `windows[${index}].start_time`),
      endTime: clockTimeInput(window.end_time, `windows[${index}].end_time`),
    };
  });
}

interface BlockedPeriodUpdate {
  periodId: string;
  draft: UnavailablePeriodDraft;
}

interface BlockedPeriodChanges {
  add: UnavailablePeriodDraft[];
  update: BlockedPeriodUpdate[];
  remove: string[];
}

function blockedPeriodDraft(input: unknown): UnavailablePeriodDraft {
  const period = inputObject(input);
  return {
    startsAt: requiredString(period, "starts_at"),
    endsAt: requiredString(period, "ends_at"),
    reason: optionalReason(period),
  };
}

function blockedPeriodChanges(input: InputObject): BlockedPeriodChanges | null {
  if (input.blocked_periods === undefined) return null;
  const changesInput = inputObject(input.blocked_periods);
  const add = arrayInput(changesInput, "add").map(blockedPeriodDraft);
  const update = arrayInput(changesInput, "update").map((item) => {
    const period = inputObject(item);
    return {
      periodId: requiredString(period, "period_id"),
      draft: blockedPeriodDraft(period),
    };
  });
  const remove = arrayInput(changesInput, "remove").map((item) => {
    const period = inputObject(item);
    if (period.confirmed !== true) {
      throw new Error("Removing a blocked period requires confirmed: true.");
    }
    return requiredString(period, "period_id");
  });
  if (add.length + update.length + remove.length === 0) {
    throw new Error("blocked_periods must include at least one add, update, or remove.");
  }
  return { add, update, remove };
}

function planningPreferencesInput(input: InputObject): Parameters<typeof account.updatePreferences>[0] | undefined {
  if (input.planning_preferences === undefined) return undefined;
  const preferences = inputObject(input.planning_preferences);
  const preferredSessionLength = preferences.preferred_session_length_minutes;
  const minimumBreak = preferences.minimum_break_minutes;
  if (
    typeof preferredSessionLength !== "number" ||
    !Number.isInteger(preferredSessionLength) ||
    preferredSessionLength < 10 ||
    preferredSessionLength > 240
  ) {
    throw new Error("preferred_session_length_minutes must be an integer from 10 to 240.");
  }
  if (
    typeof minimumBreak !== "number" ||
    !Number.isInteger(minimumBreak) ||
    minimumBreak < 0 ||
    minimumBreak > 120
  ) {
    throw new Error("minimum_break_minutes must be an integer from 0 to 120.");
  }
  return {
    timezone: requiredString(preferences, "timezone"),
    preferredSessionLength,
    minimumBreak,
  };
}

function taskOperationInput(input: InputObject): TaskOperation {
  const operation = input.operation;
  if (
    operation !== "edit" &&
    operation !== "delete" &&
    operation !== "start" &&
    operation !== "finish_early"
  ) {
    throw new Error("operation must be edit, delete, start, or finish_early.");
  }
  return operation;
}

function requireConfirmation(input: InputObject, operation: "delete" | "finish_early"): void {
  if (input.confirmed !== true) {
    throw new Error(`${operation} requires confirmed: true.`);
  }
}

async function applyStudyTimeChanges(
  input: unknown,
  signal: AbortSignal,
): Promise<StudyTimeUpdateResult> {
  const record = inputObject(input);
  const shouldConfirmTimezone = record.confirm_timezone !== undefined;
  if (shouldConfirmTimezone && record.confirm_timezone !== true) {
    throw new Error("confirm_timezone must be true when provided.");
  }
  const planningPreferences = planningPreferencesInput(record);
  const recurringWindows = recurringWindowInputs(record);
  const blockedChanges = blockedPeriodChanges(record);
  if (
    !shouldConfirmTimezone &&
    planningPreferences === undefined &&
    recurringWindows === undefined &&
    blockedChanges === null
  ) {
    throw new Error("Provide at least one study-time change.");
  }

  const savedPreferences =
    planningPreferences === undefined
      ? null
      : await account.updatePreferences(planningPreferences, signal);
  if (shouldConfirmTimezone) await availability.confirmTimezone(signal);

  const savedWindows =
    recurringWindows === undefined
      ? null
      : await availability.replaceWindows(recurringWindows, signal);
  const addedBlockedPeriods = [] as StudyTimeUpdateResult["added_blocked_periods"];
  const updatedBlockedPeriods = [] as StudyTimeUpdateResult["updated_blocked_periods"];
  const removedBlockedPeriodIds: string[] = [];
  const invalidatedFutureSessionIds: string[] = [];

  if (blockedChanges !== null) {
    for (const draft of blockedChanges.add) {
      const change = await availability.createUnavailablePeriod(draft, signal);
      addedBlockedPeriods.push(change.period);
      invalidatedFutureSessionIds.push(...change.invalidatedFutureSessionIds);
    }
    for (const changeInput of blockedChanges.update) {
      const change = await availability.updateUnavailablePeriod(
        changeInput.periodId,
        changeInput.draft,
        signal,
      );
      updatedBlockedPeriods.push(change.period);
      invalidatedFutureSessionIds.push(...change.invalidatedFutureSessionIds);
    }
    for (const periodId of blockedChanges.remove) {
      await availability.deleteUnavailablePeriod(periodId, signal);
      removedBlockedPeriodIds.push(periodId);
    }
  }

  return {
    timezone_confirmed: shouldConfirmTimezone,
    planning_preferences: savedPreferences,
    recurring_windows: savedWindows,
    added_blocked_periods: addedBlockedPeriods,
    updated_blocked_periods: updatedBlockedPeriods,
    removed_blocked_period_ids: removedBlockedPeriodIds,
    invalidated_future_session_ids: [...new Set(invalidatedFutureSessionIds)],
  };
}

function setupStatus(
  allTasks: AcademicTask[],
  windows: Awaited<ReturnType<typeof availability.listWindows>>,
  availabilityConfirmationRequired: boolean,
): "ready" | "needs_availability" | "needs_timezone_confirmation" | "needs_tasks" {
  if (availabilityConfirmationRequired) return "needs_timezone_confirmation";
  if (windows.length === 0) return "needs_availability";
  if (!allTasks.some((task) => task.status !== "Completed" && task.remainingDuration > 0)) {
    return "needs_tasks";
  }
  return "ready";
}

function taskForm(input: unknown): TaskFormData {
  const record = inputObject(input);
  const title = requiredString(record, "title");
  const category = requiredString(record, "category") as Category;
  const priority = requiredString(record, "priority") as Priority;
  const deadline = requiredString(record, "deadline_at");
  const estimate = record.original_estimate_minutes;

  if (!CATEGORIES.includes(category)) throw new Error("category is not supported.");
  if (!PRIORITIES.includes(priority)) throw new Error("priority is not supported.");
  if (
    typeof estimate !== "number" ||
    !Number.isInteger(estimate) ||
    estimate < 1 ||
    estimate > 100_000
  ) {
    throw new Error("original_estimate_minutes must be an integer from 1 to 100000.");
  }

  return {
    title,
    category,
    priority,
    deadline,
    originalEstimate: estimate,
    course: optionalString(record, "course"),
    notes: optionalString(record, "notes"),
  };
}

const readOnlyUntrusted = { readOnlyHint: true, untrustedContentHint: true } as const;
const writeUntrusted = { readOnlyHint: false, untrustedContentHint: true } as const;

function result<T>(
  data: T,
  metadata: Omit<WebMcpResult<T>, "data">,
): WebMcpResult<T> {
  return { data, ...metadata };
}

export function createStudyFlowTools(): WebMcpTool[] {
  return [
    {
      name: WEBMCP_TOOL_NAMES.getPlanState,
      title: "Read Study Plan State",
      description:
        "Read the authenticated student's tasks, deadlines, recurring study windows, active schedule, pending proposal, progress, and capacity. This never changes data.",
      inputSchema: getPlanStateSchema,
      annotations: readOnlyUntrusted,
      execute: async (input, options) => {
        const horizon = horizonDays(input);
        const signal = signalFor(options);
        const [allTasks, windows, periods, preferences, activeSchedule, pendingProposal] =
          await Promise.all([
            tasks.listTasks({}, signal),
            availability.listWindows(signal),
            availability.listUnavailablePeriods(signal),
            account.getPreferences(signal),
            scheduling.getActiveSchedule(signal),
            scheduling.getPendingRevision(signal),
          ]);
        const capacity = assessCapacity(allTasks, windows, periods, horizon);
        const progress = toEffortProgress(allTasks, activeSchedule?.sessions ?? []);

        return result(
          {
            as_of: new Date().toISOString(),
            timezone: preferences.timezone,
            setup_status: setupStatus(
              allTasks,
              windows,
              preferences.availability_confirmation_required,
            ),
            capacity: {
              horizon_days: horizon,
              available_minutes: capacity.available,
              committed_minutes: capacity.committed,
              balance_minutes: capacity.balance,
            },
            planning_preferences: {
              timezone: preferences.timezone,
              preferred_session_length_minutes: preferences.preferred_session_length_minutes,
              minimum_break_minutes: preferences.minimum_break_minutes,
              availability_confirmation_required:
                preferences.availability_confirmation_required,
            } satisfies PlanningPreferences,
            tasks: allTasks,
            availability_windows: windows,
            unavailable_periods: periods,
            active_schedule: activeSchedule,
            pending_proposal: pendingProposal,
            progress,
          },
          { active_schedule_changed: false, requires_user_review: false, persisted: false },
        );
      },
    },
    {
      name: WEBMCP_TOOL_NAMES.addTask,
      title: "Add Academic Task",
      description:
        "Create one academic task from the student's stated goal. This stores the task but does not silently activate a schedule.",
      inputSchema: addTaskSchema,
      annotations: writeUntrusted,
      execute: async (input, options) => {
        const task = await tasks.createTask(taskForm(input), signalFor(options));
        notifyStudyFlowDataChanged();
        return result(
          { task },
          { active_schedule_changed: false, requires_user_review: false, persisted: true },
        );
      },
    },
    {
      name: WEBMCP_TOOL_NAMES.updateStudyTime,
      title: "Update Study Time",
      description:
        "Update the authenticated student's planning preferences, timezone confirmation, recurring weekly study windows, and one-off blocked periods. This changes scheduling inputs only; it never generates or activates a study schedule. Planning preferences are a full replacement, recurring availability is a complete weekly replacement, and removing a blocked period requires explicit confirmation.",
      inputSchema: updateStudyTimeSchema,
      annotations: writeUntrusted,
      execute: async (input, options) => {
        const changes = await applyStudyTimeChanges(input, signalFor(options));
        notifyStudyFlowDataChanged();
        const activeScheduleChanged = changes.invalidated_future_session_ids.length > 0;
        return result(
          changes,
          {
            active_schedule_changed: activeScheduleChanged,
            requires_user_review: activeScheduleChanged,
            persisted: true,
          },
        );
      },
    },
    {
      name: WEBMCP_TOOL_NAMES.updateTask,
      title: "Manage Academic Task",
      description:
        "Manage one existing academic task. Use edit to replace all editable fields, or use start, finish_early, or delete for lifecycle actions. Delete and finish_early require explicit confirmation. These actions never silently generate or activate a new schedule.",
      inputSchema: updateTaskSchema,
      annotations: writeUntrusted,
      execute: async (input, options) => {
        const record = inputObject(input);
        const taskId = requiredString(record, "task_id");
        const operation = taskOperationInput(record);
        const signal = signalFor(options);
        if (operation === "edit") {
          const task = await tasks.updateTask(taskId, taskForm(record), signal);
          notifyStudyFlowDataChanged();
          return result<UpdateTaskResult>(
            { operation, task_id: taskId, task, deleted: false },
            { active_schedule_changed: false, requires_user_review: true, persisted: true },
          );
        }
        if (operation === "start") {
          await tasks.startTask(taskId, signal);
          const task = await tasks.getTask(taskId, signal);
          notifyStudyFlowDataChanged();
          return result<UpdateTaskResult>(
            { operation, task_id: taskId, task, deleted: false },
            { active_schedule_changed: false, requires_user_review: false, persisted: true },
          );
        }
        if (operation === "finish_early") {
          requireConfirmation(record, operation);
          await tasks.finishTaskEarly(taskId, signal);
          const task = await tasks.getTask(taskId, signal);
          notifyStudyFlowDataChanged();
          return result<UpdateTaskResult>(
            { operation, task_id: taskId, task, deleted: false },
            { active_schedule_changed: true, requires_user_review: true, persisted: true },
          );
        }
        requireConfirmation(record, operation);
        await tasks.deleteTask(taskId, signal);
        notifyStudyFlowDataChanged();
        return result<UpdateTaskResult>(
          { operation, task_id: taskId, task: null, deleted: true },
          { active_schedule_changed: true, requires_user_review: true, persisted: true },
        );
      },
    },
    {
      name: WEBMCP_TOOL_NAMES.simulatePlan,
      title: "Simulate Study Plan",
      description:
        "Compare a hypothetical study plan using one-off availability, one-off blocked periods, or hypothetical deadlines. Never persists data or changes the active schedule.",
      inputSchema: scenarioInputSchema,
      annotations: readOnlyUntrusted,
      execute: async (input, options) => {
        const scenario = scenarioInput(input, true) ?? {};
        const simulation = await scheduling.simulatePlan(scenario, signalFor(options));
        return result(
          simulation,
          { active_schedule_changed: false, requires_user_review: false, persisted: false },
        );
      },
    },
    {
      name: WEBMCP_TOOL_NAMES.draftPlan,
      title: "Draft Study Plan",
      description:
        "Create an inactive study-plan proposal from current data and an optional hypothetical scenario. The student must review it before activation.",
      inputSchema: scenarioInputSchema,
      annotations: writeUntrusted,
      execute: async (input, options) => {
        const proposal = await scheduling.generateProposal(
          scenarioInput(input, false),
          signalFor(options),
        );
        notifyStudyFlowDataChanged();
        return result(
          { proposal },
          { active_schedule_changed: false, requires_user_review: true, persisted: true },
        );
      },
    },
    {
      name: WEBMCP_TOOL_NAMES.acceptPlan,
      title: "Accept Study Plan",
      description:
        "Activate exactly one pending feasible study-plan proposal after the student explicitly approves it. This changes the active schedule.",
      inputSchema: proposalIdSchema,
      annotations: writeUntrusted,
      execute: async (input, options) => {
        const schedule = await scheduling.acceptProposal(
          idInput(input, "proposal_id"),
          signalFor(options),
        );
        notifyStudyFlowDataChanged();
        return result(
          { schedule },
          { active_schedule_changed: true, requires_user_review: false, persisted: true },
        );
      },
    },
    {
      name: WEBMCP_TOOL_NAMES.rejectPlan,
      title: "Reject Study Plan",
      description:
        "Reject exactly one pending study-plan proposal without changing the active schedule.",
      inputSchema: proposalIdSchema,
      annotations: writeUntrusted,
      execute: async (input, options) => {
        const proposalId = idInput(input, "proposal_id");
        await scheduling.rejectProposal(proposalId, signalFor(options));
        notifyStudyFlowDataChanged();
        return result(
          { proposal_id: proposalId },
          { active_schedule_changed: false, requires_user_review: false, persisted: true },
        );
      },
    },
    {
      name: WEBMCP_TOOL_NAMES.recordMissed,
      title: "Record Missed Study Session",
      description:
        "Record one past study session as missed and show the resulting recovery proposal. The recovery plan remains inactive until the student approves it.",
      inputSchema: sessionIdSchema,
      annotations: writeUntrusted,
      execute: async (input, options) => {
        const sessionId = idInput(input, "session_id");
        const outcome = await scheduling.recordOutcome(
          sessionId,
          { outcome: "Missed", actualMinutes: 0 },
          signalFor(options),
        );
        notifyStudyFlowDataChanged();
        return result(
          { session_id: outcome.session.id, recovery_proposal: outcome.revision },
          {
            active_schedule_changed: false,
            requires_user_review: outcome.revision !== null,
            persisted: true,
          },
        );
      },
    },
  ];
}
