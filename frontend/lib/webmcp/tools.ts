import { account, availability, scheduling, tasks } from "@/lib/api";
import { assessCapacity } from "@/lib/capacity";
import { notifyStudyFlowDataChanged } from "@/lib/data-events";
import { toEffortProgress } from "@/lib/api/mappers";
import { CATEGORIES, PRIORITIES } from "@/types";
import type { AcademicTask, Category, Priority, TaskFormData } from "@/types/task";
import type { ScenarioOverrides, WebMcpResult } from "./contracts";
import { WEBMCP_TOOL_NAMES } from "./contracts";
import {
  addTaskSchema,
  getPlanStateSchema,
  proposalIdSchema,
  scenarioInputSchema,
  sessionIdSchema,
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
