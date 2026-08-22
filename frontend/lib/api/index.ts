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
export * as tasks from "./tasks";

export { ApiError, API_BASE, readCsrfToken } from "./client";
export type { PreferencesInput } from "./account";
export type { CompleteRegistrationInput } from "./auth";
export type {
  UnavailablePeriodChange,
  UnavailablePeriodDraft,
  WindowDraft,
} from "./availability";
export type { TaskFilters } from "./tasks";
