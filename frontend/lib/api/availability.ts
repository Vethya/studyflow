/** Availability endpoints — `backend/src/studyflow/api/availability.py`. */

import { apiJson, apiVoid } from "./client";
import type { PreferencesInput } from "./account";
import { dayOfWeekToWireWeekday, toAvailabilityWindow, toUnavailablePeriod } from "./mappers";
import type { AvailabilityWindow, UnavailablePeriod } from "@/types/availability";
import type {
  WireAvailabilityWindow,
  WireUnavailablePeriod,
  WireUnavailablePeriodChange,
  WireStudyPreferences,
  WireStudyTimeUpdate,
} from "./wire";

export async function listWindows(signal?: AbortSignal): Promise<AvailabilityWindow[]> {
  const wire = await apiJson<WireAvailabilityWindow[]>("/availability/windows", { signal });
  return wire.map(toAvailabilityWindow);
}

export interface WindowDraft {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

/**
 * Replaces the entire weekly schedule in one call — there is no per-window
 * create or delete. Overlapping windows on the same day are merged server-side,
 * so the returned list may be shorter than what was sent. Maximum 100 windows.
 */
export async function replaceWindows(
  windows: WindowDraft[],
  signal?: AbortSignal,
): Promise<AvailabilityWindow[]> {
  const wire = await apiJson<WireAvailabilityWindow[]>("/availability/windows", {
    method: "PUT",
    body: {
      windows: windows.map((window) => ({
        weekday: dayOfWeekToWireWeekday(window.dayOfWeek),
        start_time: window.startTime,
        end_time: window.endTime,
      })),
    },
    signal,
  });
  return wire.map(toAvailabilityWindow);
}

/**
 * Acknowledges the detected timezone. Required once when
 * `availability_confirmation_required` is set on the study preferences.
 */
export function confirmTimezone(signal?: AbortSignal): Promise<void> {
  return apiVoid("/availability/confirm-timezone", {
    method: "POST",
    body: { confirmed: true },
    signal,
  });
}

export async function listUnavailablePeriods(
  signal?: AbortSignal,
): Promise<UnavailablePeriod[]> {
  const wire = await apiJson<WireUnavailablePeriod[]>("/availability/unavailable-periods", {
    signal,
  });
  return wire.map(toUnavailablePeriod);
}

export interface UnavailablePeriodDraft {
  /** RFC 3339 timestamps with an explicit UTC offset. */
  startsAt: string;
  endsAt: string;
  reason?: string;
}

export interface StudyTimeBlockedPeriodUpdate {
  periodId: string;
  draft: UnavailablePeriodDraft;
}

export interface StudyTimeBlockedPeriodChanges {
  add: UnavailablePeriodDraft[];
  update: StudyTimeBlockedPeriodUpdate[];
  remove: string[];
}

export interface StudyTimeUpdateInput {
  confirmTimezone?: boolean;
  planningPreferences?: PreferencesInput;
  recurringWindows?: WindowDraft[];
  blockedPeriods?: StudyTimeBlockedPeriodChanges;
}

export interface StudyTimeUpdateResponse {
  timezone_confirmed: boolean;
  planning_preferences: WireStudyPreferences | null;
  recurring_windows: AvailabilityWindow[] | null;
  added_blocked_periods: UnavailablePeriod[];
  updated_blocked_periods: UnavailablePeriod[];
  removed_blocked_period_ids: string[];
  invalidated_future_session_ids: string[];
}

/**
 * Creating or moving a period can invalidate already-scheduled future study
 * sessions; their ids come back so the caller can warn the student.
 */
export interface UnavailablePeriodChange {
  period: UnavailablePeriod;
  invalidatedFutureSessionIds: string[];
}

function toChange(wire: WireUnavailablePeriodChange): UnavailablePeriodChange {
  return {
    period: toUnavailablePeriod(wire.period),
    invalidatedFutureSessionIds: wire.invalidated_future_session_ids,
  };
}

function toDraftBody(draft: UnavailablePeriodDraft) {
  return {
    starts_at: draft.startsAt,
    ends_at: draft.endsAt,
    reason: draft.reason?.trim() || null,
  };
}

export async function createUnavailablePeriod(
  draft: UnavailablePeriodDraft,
  signal?: AbortSignal,
): Promise<UnavailablePeriodChange> {
  return toChange(
    await apiJson<WireUnavailablePeriodChange>("/availability/unavailable-periods", {
      method: "POST",
      body: toDraftBody(draft),
      signal,
    }),
  );
}

export async function updateUnavailablePeriod(
  periodId: string,
  draft: UnavailablePeriodDraft,
  signal?: AbortSignal,
): Promise<UnavailablePeriodChange> {
  return toChange(
    await apiJson<WireUnavailablePeriodChange>(
      `/availability/unavailable-periods/${periodId}`,
      { method: "PUT", body: toDraftBody(draft), signal },
    ),
  );
}

/** Requires explicit confirmation; the backend rejects the call without it. */
export function deleteUnavailablePeriod(
  periodId: string,
  signal?: AbortSignal,
): Promise<void> {
  return apiVoid(`/availability/unavailable-periods/${periodId}?confirmed=true`, {
    method: "DELETE",
    signal,
  });
}

export async function updateStudyTime(
  input: StudyTimeUpdateInput,
  signal?: AbortSignal,
): Promise<StudyTimeUpdateResponse> {
  const body: Record<string, unknown> = {};
  if (input.confirmTimezone) body.confirm_timezone = true;
  if (input.planningPreferences) {
    body.planning_preferences = {
      timezone: input.planningPreferences.timezone,
      preferred_session_length_minutes: input.planningPreferences.preferredSessionLength,
      minimum_break_minutes: input.planningPreferences.minimumBreak,
    };
  }
  if (input.recurringWindows) {
    body.recurring_availability = {
      replace_all: true,
      windows: input.recurringWindows.map((window) => ({
        weekday: dayOfWeekToWireWeekday(window.dayOfWeek),
        start_time: window.startTime,
        end_time: window.endTime,
      })),
    };
  }
  if (input.blockedPeriods) {
    body.blocked_periods = {
      add: input.blockedPeriods.add.map(toDraftBody),
      update: input.blockedPeriods.update.map((change) => ({
        period_id: change.periodId,
        ...toDraftBody(change.draft),
      })),
      remove: input.blockedPeriods.remove.map((periodId) => ({
        period_id: periodId,
        confirmed: true,
      })),
    };
  }

  const wire = await apiJson<WireStudyTimeUpdate>("/availability/study-time", {
    method: "PUT",
    body,
    signal,
  });
  return {
    timezone_confirmed: wire.timezone_confirmed,
    planning_preferences: wire.planning_preferences,
    recurring_windows: wire.recurring_windows?.map(toAvailabilityWindow) ?? null,
    added_blocked_periods: wire.added_blocked_periods.map(toUnavailablePeriod),
    updated_blocked_periods: wire.updated_blocked_periods.map(toUnavailablePeriod),
    removed_blocked_period_ids: wire.removed_blocked_period_ids,
    invalidated_future_session_ids: wire.invalidated_future_session_ids,
  };
}
