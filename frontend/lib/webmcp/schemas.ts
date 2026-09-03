import type { JsonSchema } from "./types";

const dateTime: JsonSchema = {
  type: "string",
  format: "date-time",
  description: "An ISO-8601 datetime with an explicit timezone offset.",
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
