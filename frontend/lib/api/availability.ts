/** Availability endpoints — `backend/src/studyflow/api/availability.py`. */

import { apiJson, apiVoid } from "./client";
import { dayOfWeekToWireWeekday, toAvailabilityWindow, toUnavailablePeriod } from "./mappers";
import type { AvailabilityWindow, UnavailablePeriod } from "@/types/availability";
import type {
  WireAvailabilityWindow,
  WireUnavailablePeriod,
  WireUnavailablePeriodChange,
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
