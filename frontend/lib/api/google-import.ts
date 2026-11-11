/**
 * One-time Google Calendar and Google Classroom import —
 * `backend/src/studyflow/api/google_import.py`.
 *
 * The flow is: start (returns Google's consent URL) → the browser goes to
 * Google → Google returns to the backend callback, which reads the data once
 * and redirects to `/import/google/{importId}` → the student picks what to
 * keep → confirm. StudyFlow never holds a Google token in the browser.
 */

import { apiJson, apiVoid } from "./client";
import { fromWireCategory, toWireCategory, toWirePriority } from "./mappers";
import type { WireTaskCategory } from "./wire";
import type { Category, Priority } from "@/types/task";

export type GoogleImportSource = "google_calendar" | "google_classroom";

export interface CalendarImportItem {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  status: "new" | "changed" | "unchanged";
}

export interface ClassroomImportItem {
  id: string;
  title: string;
  course: string | null;
  dueAt: string;
  link: string | null;
  suggestedCategory: Category;
  status: "new" | "already_imported";
}

export type GoogleImport =
  | { id: string; source: "google_calendar"; expiresAt: string; items: CalendarImportItem[] }
  | { id: string; source: "google_classroom"; expiresAt: string; items: ClassroomImportItem[] };

export interface CalendarImportResult {
  created: number;
  updated: number;
  unchanged: number;
  skippedPast: number;
  invalidatedFutureSessionIds: string[];
}

export interface ClassroomSelection {
  id: string;
  category: Category;
  priority: Priority;
  estimateMinutes: number;
}

export interface ClassroomImportResult {
  createdTaskIds: string[];
  alreadyImported: string[];
  failed: { id: string; reason: "deadline_passed" | "invalid" }[];
}

interface WireCalendarItem {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  status: CalendarImportItem["status"];
}

interface WireClassroomItem {
  id: string;
  title: string;
  course: string | null;
  due_at: string;
  link: string | null;
  suggested_category: WireTaskCategory;
  status: ClassroomImportItem["status"];
}

type WireGoogleImport =
  | { id: string; source: "google_calendar"; expires_at: string; items: WireCalendarItem[] }
  | { id: string; source: "google_classroom"; expires_at: string; items: WireClassroomItem[] };

export interface GoogleImportStatus {
  configured: boolean;
  /** When this student last asked Google for each source, if ever. */
  calendarCheckedAt: string | null;
  classroomCheckedAt: string | null;
}

export async function getStatus(signal?: AbortSignal): Promise<GoogleImportStatus> {
  const wire = await apiJson<{
    configured: boolean;
    calendar_checked_at: string | null;
    classroom_checked_at: string | null;
  }>("/integrations/google/status", { signal });
  return {
    configured: wire.configured,
    calendarCheckedAt: wire.calendar_checked_at,
    classroomCheckedAt: wire.classroom_checked_at,
  };
}

/** Starts a calendar import covering the next `horizonDays` days. */
export async function startCalendarImport(horizonDays: number): Promise<string> {
  const wire = await apiJson<{ authorization_url: string }>(
    "/integrations/google/calendar/start",
    { method: "POST", body: { horizon_days: horizonDays } },
  );
  return trustedGoogleUrl(wire.authorization_url);
}

export async function startClassroomImport(): Promise<string> {
  const wire = await apiJson<{ authorization_url: string }>(
    "/integrations/google/classroom/start",
    { method: "POST", body: {} },
  );
  return trustedGoogleUrl(wire.authorization_url);
}

export async function getImport(importId: string, signal?: AbortSignal): Promise<GoogleImport> {
  const wire = await apiJson<WireGoogleImport>(
    `/integrations/google/imports/${encodeURIComponent(importId)}`,
    { signal },
  );
  if (wire.source === "google_calendar") {
    return {
      id: wire.id,
      source: wire.source,
      expiresAt: wire.expires_at,
      items: wire.items.map((item) => ({
        id: item.id,
        title: item.title,
        startsAt: item.starts_at,
        endsAt: item.ends_at,
        allDay: item.all_day,
        status: item.status,
      })),
    };
  }
  return {
    id: wire.id,
    source: wire.source,
    expiresAt: wire.expires_at,
    items: wire.items.map((item) => ({
      id: item.id,
      title: item.title,
      course: item.course,
      dueAt: item.due_at,
      link: item.link,
      suggestedCategory: fromWireCategory(item.suggested_category),
      status: item.status,
    })),
  };
}

export async function importCalendarItems(
  importId: string,
  itemIds: string[],
): Promise<CalendarImportResult> {
  const wire = await apiJson<{
    created: number;
    updated: number;
    unchanged: number;
    skipped_past: number;
    invalidated_future_session_ids: string[];
  }>(`/integrations/google/imports/${encodeURIComponent(importId)}/calendar`, {
    method: "POST",
    body: { item_ids: itemIds },
  });
  return {
    created: wire.created,
    updated: wire.updated,
    unchanged: wire.unchanged,
    skippedPast: wire.skipped_past,
    invalidatedFutureSessionIds: wire.invalidated_future_session_ids,
  };
}

export async function importClassroomItems(
  importId: string,
  selections: ClassroomSelection[],
): Promise<ClassroomImportResult> {
  const wire = await apiJson<{
    created_task_ids: string[];
    already_imported: string[];
    failed: { id: string; reason: "deadline_passed" | "invalid" }[];
  }>(`/integrations/google/imports/${encodeURIComponent(importId)}/classroom`, {
    method: "POST",
    body: {
      items: selections.map((selection) => ({
        id: selection.id,
        category: toWireCategory(selection.category),
        priority: toWirePriority(selection.priority),
        estimate_minutes: selection.estimateMinutes,
      })),
    },
  });
  return {
    createdTaskIds: wire.created_task_ids,
    alreadyImported: wire.already_imported,
    failed: wire.failed,
  };
}

export function discardImport(importId: string): Promise<void> {
  return apiVoid(`/integrations/google/imports/${encodeURIComponent(importId)}`, {
    method: "DELETE",
  });
}

/**
 * The browser is about to navigate to this URL, so it must be Google's
 * consent page and nothing else, even if a response were tampered with.
 */
export function trustedGoogleUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "accounts.google.com") {
    throw new Error("Unexpected Google authorization URL");
  }
  return url.toString();
}
