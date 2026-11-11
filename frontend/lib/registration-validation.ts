import { ApiError } from "@/lib/api";

export type RegistrationField = "name" | "password" | "confirm" | "timezone";
export type RegistrationFieldErrors = Partial<Record<RegistrationField, string>>;

export interface RegistrationDraft {
  name: string;
  password: string;
  confirm: string;
}

/** Client-side checks that mirror the backend's completion rules (SPEC §6.2). */
export function validateRegistration(draft: RegistrationDraft): RegistrationFieldErrors {
  const errors: RegistrationFieldErrors = {};
  if (!draft.name.trim()) errors.name = "Enter your name.";
  else if (draft.name.trim().length > 200) errors.name = "Use 200 characters or fewer.";

  if (draft.password.length < 12) errors.password = "Use at least 12 characters.";
  else if (draft.password.length > 128) errors.password = "Use 128 characters or fewer.";

  if (!draft.confirm) errors.confirm = "Enter your password again.";
  else if (draft.password !== draft.confirm) errors.confirm = "Passwords do not match.";
  return errors;
}

/**
 * Maps a rejected completion to the field it concerns. Returns `null` when the
 * error is not about a single field and belongs in the page-level alert.
 */
export function registrationFieldErrorsFrom(cause: unknown): RegistrationFieldErrors | null {
  if (!(cause instanceof ApiError) || !cause.isValidation) return null;

  const errors: RegistrationFieldErrors = {};
  for (const field of ["name", "password", "timezone"] as const) {
    const message = cause.fieldErrors[field];
    if (message) errors[field] = message;
  }
  // The password policy (length or known breach) is reported as a plain detail.
  if (Object.keys(errors).length === 0 && /password/i.test(cause.detail)) {
    errors.password =
      "This password is not allowed. It may appear in a known data breach, so choose a different one.";
  }
  return Object.keys(errors).length > 0 ? errors : null;
}
