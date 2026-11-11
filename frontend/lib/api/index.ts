/**
 * StudyFlow API client.
 *
 * Every endpoint the FastAPI backend exposes is reachable from here. Import
 * the namespaces rather than the individual modules so call sites read as
 * `tasks.listTasks(...)` / `auth.login(...)`.
 */

export * as account from "./account";
export * as auth from "./auth";
export * as availability from "./availability";
export * as googleImport from "./google-import";
export * as reminders from "./reminders";
export * as scheduling from "./scheduling";
export * as system from "./system";
export * as tasks from "./tasks";

export { ApiError, API_BASE, readCsrfToken } from "./client";
export { ScheduleTechnicalFailure, ensureSentence } from "./scheduling";
export type { PreferencesInput } from "./account";
export type { CompleteRegistrationInput } from "./auth";
export type { ReminderPreferences, ReminderPreferencesInput } from "./reminders";
export type {
  UnavailablePeriodChange,
  UnavailablePeriodDraft,
  WindowDraft,
} from "./availability";
export type { HealthReport, ReadinessReport } from "./system";
export type { OutcomeResult, SessionFilters } from "./scheduling";
export type { TaskFilters, TaskPage } from "./tasks";
