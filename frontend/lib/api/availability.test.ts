import { afterEach, expect, it, vi } from "vitest";
import {
  confirmTimezone,
  createUnavailablePeriod,
  deleteUnavailablePeriod,
  listUnavailablePeriods,
  listWindows,
  replaceWindows,
  updateStudyTime,
  updateUnavailablePeriod,
} from "./availability";

afterEach(() => vi.unstubAllGlobals());

const windowWire = {
  id: "window-1",
  weekday: 0,
  start_time: "18:00:00",
  end_time: "21:30:00",
  crosses_midnight: false,
};

const periodWire = {
  id: "period-1",
  starts_at: "2026-10-02T09:00:00+07:00",
  ends_at: "2026-10-02T12:00:00+07:00",
  reason: "Exam",
};

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn(async () => Response.json(body, { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>) {
  return JSON.parse(fetchMock.mock.calls[0][1].body as string);
}

it("maps backend weekdays and trims seconds from availability windows", async () => {
  stubFetch([windowWire]);

  await expect(listWindows()).resolves.toEqual([
    { id: "window-1", dayOfWeek: 1, startTime: "18:00", endTime: "21:30" },
  ]);
});

it("replaces recurring windows with the backend weekday contract", async () => {
  const fetchMock = stubFetch({ windows: [windowWire], invalidated_future_session_ids: ["s-1"] });

  await expect(
    replaceWindows([{ dayOfWeek: 0, startTime: "09:00", endTime: "12:00" }]),
  ).resolves.toEqual({
    windows: [{ id: "window-1", dayOfWeek: 1, startTime: "18:00", endTime: "21:30" }],
    invalidatedFutureSessionIds: ["s-1"],
  });
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/v1/availability/windows",
    expect.objectContaining({ method: "PUT" }),
  );
  expect(requestBody(fetchMock)).toEqual({
    windows: [{ weekday: 6, start_time: "09:00", end_time: "12:00" }],
  });
});

it("trims an optional blocked-period reason and maps the saved period", async () => {
  const fetchMock = stubFetch({ period: periodWire, invalidated_future_session_ids: ["s-2"] });

  await expect(
    createUnavailablePeriod({
      startsAt: periodWire.starts_at,
      endsAt: periodWire.ends_at,
      reason: "  Exam  ",
    }),
  ).resolves.toEqual({
    period: {
      id: "period-1",
      title: "Exam",
      startDate: periodWire.starts_at,
      endDate: periodWire.ends_at,
      reason: "Exam",
    },
    invalidatedFutureSessionIds: ["s-2"],
  });
  expect(requestBody(fetchMock)).toEqual({
    starts_at: periodWire.starts_at,
    ends_at: periodWire.ends_at,
    reason: "Exam",
  });
});

it("lists, updates, and explicitly confirms deletion of blocked periods", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith("/unavailable-periods")) return Response.json([periodWire]);
    if (path.includes("/unavailable-periods/")) {
      return Response.json({ period: periodWire, invalidated_future_session_ids: [] });
    }
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal("fetch", fetchMock);

  await expect(listUnavailablePeriods()).resolves.toMatchObject([{ id: "period-1", title: "Exam" }]);
  await updateUnavailablePeriod("period-1", {
    startsAt: periodWire.starts_at,
    endsAt: periodWire.ends_at,
  });
  await deleteUnavailablePeriod("period-1");

  expect(fetchMock).toHaveBeenNthCalledWith(
    2,
    "/api/v1/availability/unavailable-periods/period-1",
    expect.objectContaining({ method: "PUT" }),
  );
  expect(fetchMock).toHaveBeenNthCalledWith(
    3,
    "/api/v1/availability/unavailable-periods/period-1?confirmed=true",
    expect.objectContaining({ method: "DELETE" }),
  );
});

it("sends one combined study-time update and maps its response", async () => {
  const fetchMock = stubFetch({
    timezone_confirmed: true,
    planning_preferences: {
      timezone: "Asia/Phnom_Penh",
      preferred_session_length_minutes: 50,
      minimum_break_minutes: 10,
      availability_confirmation_required: false,
    },
    recurring_windows: [windowWire],
    added_blocked_periods: [periodWire],
    updated_blocked_periods: [],
    removed_blocked_period_ids: ["old-period"],
    invalidated_future_session_ids: ["s-3"],
  });

  await expect(
    updateStudyTime({
      confirmTimezone: true,
      planningPreferences: {
        timezone: "Asia/Phnom_Penh",
        preferredSessionLength: 50,
        minimumBreak: 10,
      },
      recurringWindows: [{ dayOfWeek: 0, startTime: "09:00", endTime: "12:00" }],
      blockedPeriods: {
        add: [{ startsAt: periodWire.starts_at, endsAt: periodWire.ends_at, reason: "  Exam " }],
        update: [{ periodId: "period-1", draft: { startsAt: periodWire.starts_at, endsAt: periodWire.ends_at } }],
        remove: ["old-period"],
      },
    }),
  ).resolves.toMatchObject({
    timezone_confirmed: true,
    recurring_windows: [{ dayOfWeek: 1, startTime: "18:00", endTime: "21:30" }],
    removed_blocked_period_ids: ["old-period"],
    invalidated_future_session_ids: ["s-3"],
  });

  expect(fetchMock).toHaveBeenCalledWith(
    "/api/v1/availability/study-time",
    expect.objectContaining({ method: "PUT" }),
  );
  expect(requestBody(fetchMock)).toEqual({
    confirm_timezone: true,
    planning_preferences: {
      timezone: "Asia/Phnom_Penh",
      preferred_session_length_minutes: 50,
      minimum_break_minutes: 10,
    },
    recurring_availability: {
      replace_all: true,
      windows: [{ weekday: 6, start_time: "09:00", end_time: "12:00" }],
    },
    blocked_periods: {
      add: [{ starts_at: periodWire.starts_at, ends_at: periodWire.ends_at, reason: "Exam" }],
      update: [{ period_id: "period-1", starts_at: periodWire.starts_at, ends_at: periodWire.ends_at, reason: null }],
      remove: [{ period_id: "old-period", confirmed: true }],
    },
  });
});

it("confirms the detected timezone with an explicit request body", async () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  await confirmTimezone();
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/v1/availability/confirm-timezone",
    expect.objectContaining({ method: "POST", body: JSON.stringify({ confirmed: true }) }),
  );
});

it("sends an empty study-time update without inventing optional sections", async () => {
  const fetchMock = stubFetch({
    timezone_confirmed: false,
    planning_preferences: null,
    recurring_windows: null,
    added_blocked_periods: [],
    updated_blocked_periods: [],
    removed_blocked_period_ids: [],
    invalidated_future_session_ids: [],
  });

  await expect(updateStudyTime({})).resolves.toEqual({
    timezone_confirmed: false,
    planning_preferences: null,
    recurring_windows: null,
    added_blocked_periods: [],
    updated_blocked_periods: [],
    removed_blocked_period_ids: [],
    invalidated_future_session_ids: [],
  });
  expect(requestBody(fetchMock)).toEqual({});
});
