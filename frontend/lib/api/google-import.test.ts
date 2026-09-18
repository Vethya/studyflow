import { afterEach, expect, it, vi } from "vitest";
import {
  getImport,
  getStatus,
  importClassroomItems,
  startCalendarImport,
  trustedGoogleUrl,
} from "./google-import";

afterEach(() => vi.unstubAllGlobals());

it("only follows HTTPS authorization URLs on accounts.google.com", () => {
  expect(trustedGoogleUrl("https://accounts.google.com/o/oauth2/v2/auth?state=x")).toBe(
    "https://accounts.google.com/o/oauth2/v2/auth?state=x",
  );
  expect(() => trustedGoogleUrl("https://accounts.google.com.evil.example/auth")).toThrow();
  expect(() => trustedGoogleUrl("http://accounts.google.com/o/oauth2/v2/auth")).toThrow();
  expect(() => trustedGoogleUrl("javascript:alert(1)")).toThrow();
});

it("starts a calendar import with the chosen horizon", async () => {
  const fetchMock = vi.fn(async () =>
    Response.json({ authorization_url: "https://evil.example/phish" }),
  );
  vi.stubGlobal("fetch", fetchMock);

  await expect(startCalendarImport(14)).rejects.toThrow("Unexpected Google authorization URL");
  const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(path).toBe("/api/v1/integrations/google/calendar/start");
  expect(JSON.parse(String(init.body))).toEqual({ horizon_days: 14 });
});

it("maps both import previews from the wire format", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("calendar-import")
        ? Response.json({
            id: "calendar-import",
            source: "google_calendar",
            expires_at: "2026-09-18T08:30:00Z",
            items: [
              {
                id: "a".repeat(64),
                title: "Shift",
                starts_at: "2026-09-19T10:00:00Z",
                ends_at: "2026-09-19T14:00:00Z",
                all_day: false,
                status: "new",
              },
            ],
          })
        : Response.json({
            id: "classroom-import",
            source: "google_classroom",
            expires_at: "2026-09-18T08:30:00Z",
            items: [
              {
                id: "b".repeat(64),
                title: "Midterm",
                course: "Physics",
                due_at: "2026-09-25T16:30:00Z",
                link: null,
                suggested_category: "exam_preparation",
                status: "already_imported",
              },
            ],
          }),
    ),
  );

  await expect(getImport("calendar-import")).resolves.toEqual({
    id: "calendar-import",
    source: "google_calendar",
    expiresAt: "2026-09-18T08:30:00Z",
    items: [
      {
        id: "a".repeat(64),
        title: "Shift",
        startsAt: "2026-09-19T10:00:00Z",
        endsAt: "2026-09-19T14:00:00Z",
        allDay: false,
        status: "new",
      },
    ],
  });
  const classroom = await getImport("classroom-import");
  expect(classroom.source).toBe("google_classroom");
  expect(classroom.items[0]).toMatchObject({
    course: "Physics",
    dueAt: "2026-09-25T16:30:00Z",
    suggestedCategory: "Exam Preparation",
    status: "already_imported",
  });
});

it("sends classroom selections in wire enums", async () => {
  const fetchMock = vi.fn(async () =>
    Response.json({ created_task_ids: ["task-1"], already_imported: [], failed: [] }),
  );
  vi.stubGlobal("fetch", fetchMock);

  await expect(
    importClassroomItems("import/1", [
      { id: "c".repeat(64), category: "Research/Writing", priority: "High", estimateMinutes: 90 },
    ]),
  ).resolves.toEqual({ createdTaskIds: ["task-1"], alreadyImported: [], failed: [] });

  const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(path).toBe("/api/v1/integrations/google/imports/import%2F1/classroom");
  expect(JSON.parse(String(init.body))).toEqual({
    items: [
      { id: "c".repeat(64), category: "research_writing", priority: "high", estimate_minutes: 90 },
    ],
  });
});

it("maps the import status, including when Google was last checked", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        configured: true,
        calendar_checked_at: null,
        classroom_checked_at: "2026-09-12T08:00:00Z",
      }),
    ),
  );

  await expect(getStatus()).resolves.toEqual({
    configured: true,
    calendarCheckedAt: null,
    classroomCheckedAt: "2026-09-12T08:00:00Z",
  });
});
