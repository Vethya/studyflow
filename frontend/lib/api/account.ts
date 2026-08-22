/** Account profile, preferences and password — `backend/src/studyflow/api/account.py`. */

import { apiJson, apiVoid } from "./client";
import { toStudentAccount } from "./mappers";
import type { StudentAccount } from "@/types/user";
import type { WireAccountProfile, WireLinkedIdentity, WireStudyPreferences } from "./wire";

export function getProfile(signal?: AbortSignal): Promise<WireAccountProfile> {
  return apiJson<WireAccountProfile>("/account/profile", { signal });
}

export function updateProfile(name: string): Promise<WireAccountProfile> {
  return apiJson<WireAccountProfile>("/account/profile", {
    method: "PATCH",
    body: { name },
  });
}

export function getPreferences(signal?: AbortSignal): Promise<WireStudyPreferences> {
  return apiJson<WireStudyPreferences>("/account/preferences", { signal });
}

export interface PreferencesInput {
  timezone: string;
  preferredSessionLength: number;
  minimumBreak: number;
}

/**
 * The backend requires all three fields on every update, so callers must send
 * the current values for anything they are not changing.
 */
export function updatePreferences(input: PreferencesInput): Promise<WireStudyPreferences> {
  return apiJson<WireStudyPreferences>("/account/preferences", {
    method: "PATCH",
    body: {
      timezone: input.timezone,
      preferred_session_length_minutes: input.preferredSessionLength,
      minimum_break_minutes: input.minimumBreak,
    },
  });
}

export function getLinkedIdentities(signal?: AbortSignal): Promise<WireLinkedIdentity[]> {
  return apiJson<WireLinkedIdentity[]>("/account/identities", { signal });
}

/** New passwords must be at least 12 characters and are checked against known breaches. */
export function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  return apiVoid("/account/password", {
    method: "PATCH",
    body: { current_password: currentPassword, new_password: newPassword },
  });
}

/** Convenience read that assembles the full `StudentAccount` the UI expects. */
export async function getAccount(signal?: AbortSignal): Promise<StudentAccount> {
  const [profile, preferences, identities] = await Promise.all([
    getProfile(signal),
    getPreferences(signal),
    getLinkedIdentities(signal),
  ]);
  return toStudentAccount(profile, preferences, identities);
}
