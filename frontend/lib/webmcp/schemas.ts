import type { JsonSchema } from "./types";

const dateTime: JsonSchema = {
  type: "string",
  format: "date-time",
  description: "An ISO-8601 datetime with an explicit timezone offset.",
};

const clockTime: JsonSchema = {
  type: "string",
  pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$",
  description: "A local clock time in 24-hour HH:mm format.",
};

const scenarioAvailabilityItem: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    starts_at: dateTime,
    ends_at: dateTime,
  },
  required: ["starts_at", "ends_at"],
};

const scenarioBlockedItem: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    starts_at: dateTime,
    ends_at: dateTime,
    reason: { type: "string", maxLength: 200 },
  },
  required: ["starts_at", "ends_at"],
};

const deadlineOverrideItem: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    task_id: { type: "string", format: "uuid" },
    deadline_at: dateTime,
  },
  required: ["task_id", "deadline_at"],
};

export const scenarioSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    temporary_availability: {
      type: "array",
      maxItems: 32,
      items: scenarioAvailabilityItem,
      description: "One-off study windows that do not change recurring availability.",
    },
    temporary_blocked_periods: {
      type: "array",
      maxItems: 32,
      items: scenarioBlockedItem,
      description: "One-off periods unavailable only in this scenario.",
    },
    deadline_overrides: {
      type: "array",
      maxItems: 64,
      items: deadlineOverrideItem,
      description: "Hypothetical deadlines used only for this planning run.",
    },
  },
};

export const getPlanStateSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    horizon_days: {
      type: "integer",
      enum: [7, 14, 30],
      default: 7,
      description: "How many days of capacity to summarize.",
    },
  },
};

export const addTaskSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", minLength: 1, maxLength: 200 },
    category: {
      type: "string",
      enum: ["Assignment", "Reading", "Exam Preparation", "Project", "Research/Writing", "Other"],
    },
    priority: { type: "string", enum: ["Low", "Medium", "High"] },
    course: { type: ["string", "null"], maxLength: 100 },
    notes: { type: ["string", "null"], maxLength: 2000 },
    deadline_at: dateTime,
    original_estimate_minutes: { type: "integer", minimum: 1, maximum: 100_000 },
  },
  required: ["title", "category", "priority", "deadline_at", "original_estimate_minutes"],
};

const recurringWindowSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    day: {
      type: "string",
      enum: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    },
    start_time: clockTime,
    end_time: clockTime,
  },
  required: ["day", "start_time", "end_time"],
};

const blockedPeriodDraftSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    starts_at: dateTime,
    ends_at: dateTime,
    reason: { type: ["string", "null"], maxLength: 200 },
  },
  required: ["starts_at", "ends_at"],
};

const blockedPeriodUpdateSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    period_id: { type: "string", format: "uuid" },
    starts_at: dateTime,
    ends_at: dateTime,
    reason: { type: ["string", "null"], maxLength: 200 },
  },
  required: ["period_id", "starts_at", "ends_at"],
};

const blockedPeriodRemovalSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    period_id: { type: "string", format: "uuid" },
    confirmed: { const: true },
  },
  required: ["period_id", "confirmed"],
};

const taskFields: Record<string, JsonSchema> = {
  title: { type: "string", minLength: 1, maxLength: 200 },
  category: {
    type: "string",
    enum: ["Assignment", "Reading", "Exam Preparation", "Project", "Research/Writing", "Other"],
  },
  priority: { type: "string", enum: ["Low", "Medium", "High"] },
  course: { type: ["string", "null"], maxLength: 100 },
  notes: { type: ["string", "null"], maxLength: 2000 },
  deadline_at: dateTime,
  original_estimate_minutes: { type: "integer", minimum: 1, maximum: 100_000 },
};

const taskEditSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    operation: { const: "edit" },
    task_id: { type: "string", format: "uuid" },
    ...taskFields,
  },
  required: [
    "operation",
    "task_id",
    "title",
    "category",
    "priority",
    "deadline_at",
    "original_estimate_minutes",
  ],
};

const taskDeleteSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    operation: { const: "delete" },
    task_id: { type: "string", format: "uuid" },
    confirmed: { const: true },
  },
  required: ["operation", "task_id", "confirmed"],
};

const taskStartSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    operation: { const: "start" },
    task_id: { type: "string", format: "uuid" },
  },
  required: ["operation", "task_id"],
};

const taskFinishEarlySchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    operation: { const: "finish_early" },
    task_id: { type: "string", format: "uuid" },
    confirmed: { const: true },
  },
  required: ["operation", "task_id", "confirmed"],
};

export const updateStudyTimeSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    confirm_timezone: {
      const: true,
      description: "Confirm the timezone detected by StudyFlow for this account.",
    },
    planning_preferences: {
      type: "object",
      additionalProperties: false,
      properties: {
        timezone: {
          type: "string",
          minLength: 1,
          maxLength: 64,
          description: "A valid IANA timezone such as Asia/Phnom_Penh.",
        },
        preferred_session_length_minutes: {
          type: "integer",
          minimum: 10,
          maximum: 240,
        },
        minimum_break_minutes: {
          type: "integer",
          minimum: 0,
          maximum: 120,
        },
      },
      required: [
        "timezone",
        "preferred_session_length_minutes",
        "minimum_break_minutes",
      ],
    },
    recurring_availability: {
      type: "object",
      additionalProperties: false,
      properties: {
        replace_all: {
          const: true,
          description: "Required because this replaces the complete weekly pattern.",
        },
        windows: {
          type: "array",
          maxItems: 100,
          items: recurringWindowSchema,
        },
      },
      required: ["replace_all", "windows"],
    },
    blocked_periods: {
      type: "object",
      additionalProperties: false,
      properties: {
        add: { type: "array", maxItems: 64, items: blockedPeriodDraftSchema },
        update: { type: "array", maxItems: 64, items: blockedPeriodUpdateSchema },
        remove: { type: "array", maxItems: 64, items: blockedPeriodRemovalSchema },
      },
    },
  },
  anyOf: [
    { required: ["confirm_timezone"] },
    { required: ["planning_preferences"] },
    { required: ["recurring_availability"] },
    { required: ["blocked_periods"] },
  ],
};

export const updateTaskSchema: JsonSchema = {
  oneOf: [taskEditSchema, taskDeleteSchema, taskStartSchema, taskFinishEarlySchema],
  description:
    "Manage one academic task. Use edit for full field replacement, or use a lifecycle operation with only the fields it requires.",
};

export const scenarioInputSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    scenario: scenarioSchema,
  },
};

export const proposalIdSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    proposal_id: { type: "string", format: "uuid" },
  },
  required: ["proposal_id"],
};

export const sessionIdSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    session_id: { type: "string", format: "uuid" },
  },
  required: ["session_id"],
};
