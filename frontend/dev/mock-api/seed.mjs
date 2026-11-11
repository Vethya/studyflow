/**
 * Fresh demo data for the mock API. Every date is computed relative to the
 * moment the server starts, in the account timezone, so the dashboard always
 * shows a believable "this week".
 */

import { createHash, randomUUID } from "node:crypto";
import { MINUTE, addLocalDays, atLocal, ceilTo, clockMinutes, localDate } from "./time.mjs";

export const DEMO_TIMEZONE = "Asia/Phnom_Penh";
export const DEMO_PASSWORD = "demo-password-123";
export const NEW_STUDENT_EMAIL = "new.student@example.com";
export const NEW_STUDENT_PASSWORD = "new-student-123";

/**
 * Completed-task history per category, used by the adaptive estimate
 * preview. Research/Writing has a large first-time correction, so choosing
 * Adaptive there asks for an acknowledgment first.
 */
export const ADAPTIVE_HISTORY = {
  assignment: { factor: "1.2500", scope: "category", count: 6, basisScope: "category", provisional: 1, spread: [0.85, 1.25] },
  reading: { factor: "1.1000", scope: "overall", count: 14, basisScope: "size", provisional: 0, spread: [0.9, 1.2] },
  exam_preparation: { factor: "1.1500", scope: "category", count: 5, basisScope: "category", provisional: 2, spread: [0.8, 1.3] },
  project: { factor: "1.2000", scope: "overall", count: 14, basisScope: "overall", provisional: 1, spread: [0.8, 1.35] },
  research_writing: { factor: "1.6000", scope: "category", count: 5, acknowledgmentRequired: true, basisScope: "category", provisional: 0, spread: [0.8, 1.3] },
  other: null,
};

/** The demo account's aggregate estimate accuracy shown on the Progress page. */
export const DEMO_ESTIMATION_ACCURACY = {
  sample_size: 12,
  original_mean_absolute_error_minutes: 38.4,
  adaptive_mean_absolute_error_minutes: 24.1,
  improvement_percent: 37.2,
  adaptive_qualified: true,
};

export const CALENDAR_IMPORT_ID = "mock-calendar";
export const CLASSROOM_IMPORT_ID = "mock-classroom";

/** Google item ids are opaque 64-character hex strings. */
const googleId = (key) => createHash("sha256").update(key).digest("hex");

/** Events a Google Calendar import would offer, relative to `now`. */
export function calendarImportItems(now, timeZone) {
  const today = localDate(now, timeZone);
  const day = (offset, clock) => atLocal(addLocalDays(today, offset), clock, timeZone);
  return [
    { id: googleId("calendar:shift"), title: "Part-time shift", startsAt: day(2, "17:30"), endsAt: day(2, "21:00"), allDay: false },
    { id: googleId("calendar:dentist"), title: "Dentist appointment", startsAt: day(5, "18:30"), endsAt: day(5, "19:30"), allDay: false },
    { id: googleId("calendar:trip"), title: "Family trip", startsAt: day(9, "00:00"), endsAt: day(11, "00:00"), allDay: true },
    { id: googleId("calendar:seminar"), title: "Seminar: Research ethics", startsAt: day(-1, "14:00"), endsAt: day(-1, "16:00"), allDay: false },
  ];
}

/** Coursework a Google Classroom import would offer, relative to `now`. */
export function classroomImportItems(now, timeZone) {
  const today = localDate(now, timeZone);
  const day = (offset, clock) => atLocal(addLocalDays(today, offset), clock, timeZone);
  return [
    {
      id: googleId("classroom:lab-report"),
      title: "Lab report 2: Matrix transformations",
      course: "Linear Algebra",
      dueAt: day(4, "23:59"),
      link: "https://classroom.google.com/c/mock/a/lab-report-2/details",
      suggestedCategory: "assignment",
    },
    {
      id: googleId("classroom:reading-response"),
      title: "Reading response: Primary sources",
      course: "Modern History",
      dueAt: day(8, "23:59"),
      link: "https://classroom.google.com/c/mock/a/reading-response/details",
      suggestedCategory: "reading",
    },
    {
      id: googleId("classroom:practice-set"),
      title: "Midterm practice set",
      course: "Algorithms",
      dueAt: day(9, "12:00"),
      link: null,
      suggestedCategory: "exam_preparation",
    },
    {
      id: googleId("classroom:reflection"),
      title: "Week 1 reflection",
      course: "Academic Writing",
      dueAt: day(-3, "23:59"),
      link: null,
      suggestedCategory: "research_writing",
    },
  ];
}

// Python weekday numbering: 0 = Monday … 6 = Sunday.
const WEEKLY_WINDOWS = [
  [0, "18:00", "21:00"],
  [1, "18:00", "21:00"],
  [2, "18:00", "21:00"],
  [3, "18:00", "21:00"],
  [4, "18:00", "21:00"],
  [5, "09:00", "12:00"],
  [5, "14:00", "17:00"],
  [6, "15:00", "18:00"],
];

function task(fields, now) {
  return {
    id: randomUUID(),
    course: null,
    notes: null,
    adaptive: null,
    plannedSource: "original",
    frozen: false,
    completedAt: null,
    importedFrom: null,
    createdAt: now - 10 * 24 * 60 * MINUTE,
    updatedAt: now - 2 * 24 * 60 * MINUTE,
    ...fields,
    planned: fields.planned ?? fields.original,
  };
}

export function createSeedState(now = Date.now()) {
  const tz = DEMO_TIMEZONE;
  const today = localDate(now, tz);
  const day = (offset, clock) => atLocal(addLocalDays(today, offset), clock, tz);

  const windows = WEEKLY_WINDOWS.map(([weekday, start, end]) => ({
    id: randomUUID(),
    weekday,
    start,
    end,
  }));

  const periods = [
    {
      id: randomUUID(),
      startsAt: day(4, "17:30"),
      endsAt: day(4, "21:30"),
      reason: "Part-time shift",
      importKey: null,
    },
    {
      // Imported earlier at a different time, so the calendar import reports it as changed.
      id: randomUUID(),
      startsAt: day(5, "18:00"),
      endsAt: day(5, "19:00"),
      reason: "Dentist appointment",
      importKey: googleId("calendar:dentist"),
    },
  ];

  const T = {
    reading: task(
      {
        title: "Read Chapter 7: The Industrial Revolution",
        category: "reading",
        priority: "medium",
        course: "Modern History",
        notes: "Focus on the sections about labour and urbanisation.",
        deadline: day(-1, "17:00"),
        original: 120,
        frozen: true,
      },
      now,
    ),
    problemSet: task(
      {
        title: "Problem Set 4: Graph Algorithms",
        category: "assignment",
        priority: "high",
        course: "Algorithms",
        notes: "Questions 1–6. Show the Dijkstra trace for Q3.",
        deadline: day(1, "23:59"),
        original: 160,
        adaptive: 200,
        plannedSource: "adaptive",
        planned: 200,
        frozen: true,
      },
      now,
    ),
    midterm: task(
      {
        title: "Linear Algebra Midterm Prep",
        category: "exam_preparation",
        priority: "high",
        course: "Linear Algebra",
        notes: "Past papers 2022–2024, then eigenvalues and diagonalisation.",
        deadline: day(6, "18:00"),
        original: 300,
        frozen: true,
      },
      now,
    ),
    bibliography: task(
      {
        title: "Annotated bibliography",
        category: "research_writing",
        priority: "medium",
        course: "Academic Writing",
        notes: "At least eight peer-reviewed sources, APA 7.",
        deadline: day(3, "23:59"),
        original: 120,
      },
      now,
    ),
    project: task(
      {
        title: "Group project: Route planner prototype",
        category: "project",
        priority: "high",
        course: "Algorithms",
        notes: "My part: the A* search module and its tests.",
        deadline: day(17, "23:59"),
        original: 480,
      },
      now,
    ),
    lectureNotes: task(
      {
        title: "Tidy lecture notes for week 5",
        category: "other",
        priority: "low",
        course: "Modern History",
        deadline: day(0, "23:59"),
        original: 30,
      },
      now,
    ),
    primer: task(
      {
        title: "Read: Matrix decompositions primer",
        category: "reading",
        priority: "low",
        course: "Linear Algebra",
        deadline: day(14, "23:59"),
        original: 90,
      },
      now,
    ),
    essayOutline: task(
      {
        title: "Essay outline: Causes of the First World War",
        category: "research_writing",
        priority: "medium",
        course: "Modern History",
        deadline: day(-4, "23:59"),
        original: 90,
        frozen: true,
        completedAt: now,
      },
      now,
    ),
    quizReview: task(
      {
        title: "Quiz 3 review",
        category: "exam_preparation",
        priority: "low",
        course: "Linear Algebra",
        deadline: day(-2, "12:00"),
        original: 60,
        frozen: true,
        completedAt: now,
      },
      now,
    ),
  };

  // ─── Sessions placed in the weekly windows ─────────────────────
  const used = new Set();
  const slotsForDay = (offset) => {
    const date = addLocalDays(today, offset);
    const slots = [];
    for (const window of windows) {
      if (window.weekday !== date.weekday) continue;
      const end = clockMinutes(window.end);
      for (let start = clockMinutes(window.start); start + 50 <= end; start += 60) {
        const startsAt = atLocal(date, start, tz);
        const blocked = periods.some(
          (period) => period.startsAt < startsAt + 50 * MINUTE && period.endsAt > startsAt,
        );
        if (!blocked) slots.push(startsAt);
      }
    }
    return slots.sort((a, b) => a - b);
  };

  /** The `index`-th free slot on a day, rolling forward to later days when the day is full. */
  const takeSlot = (offset, index, isFuture) => {
    for (let candidateDay = offset; candidateDay < offset + 14; candidateDay += 1) {
      const free = slotsForDay(candidateDay).filter(
        (start) =>
          !used.has(start) &&
          (isFuture ? start > now : start + 50 * MINUTE <= now),
      );
      if (free.length === 0) continue;
      const start = free[Math.min(candidateDay === offset ? index : 0, free.length - 1)];
      used.add(start);
      return start;
    }
    throw new Error(`No free demo slot near day ${offset}`);
  };

  const sessions = [];
  const addSession = (taskRef, startsAt, minutes, outcome = null) => {
    sessions.push({
      id: randomUUID(),
      taskId: taskRef.id,
      startsAt,
      endsAt: startsAt + minutes * MINUTE,
      planned: minutes,
      outcome,
    });
  };
  const recorded = (startsAt, minutes, kind, actual, remaining, rescheduled = false) => {
    const recordedAt = startsAt + (minutes + 25) * MINUTE;
    return {
      kind,
      actual,
      remaining,
      recordedAt,
      rescheduledAt: rescheduled ? recordedAt + 5 * MINUTE : null,
    };
  };
  const past = (taskRef, offset, index, minutes, outcome) => {
    const startsAt = takeSlot(offset, index, false);
    addSession(taskRef, startsAt, minutes, outcome ? outcome(startsAt) : null);
  };

  // Completed history.
  past(T.essayOutline, -6, 0, 50, (s) => recorded(s, 50, "completed", 55, 0));
  past(T.essayOutline, -5, 0, 50, (s) => recorded(s, 50, "completed", 60, 0));
  past(T.reading, -4, 0, 50, (s) => recorded(s, 50, "completed", 45, 0));
  past(T.quizReview, -4, 1, 50, (s) => recorded(s, 50, "completed", 50, 0));
  past(T.problemSet, -3, 0, 50, (s) => recorded(s, 50, "completed", 70, 0));
  past(T.midterm, -3, 1, 50, (s) => recorded(s, 50, "completed", 50, 0));
  // Missed and delayed work that has already been replanned.
  past(T.reading, -2, 0, 50, (s) => recorded(s, 50, "missed", 0, 50, true));
  past(T.problemSet, -2, 1, 50, (s) => recorded(s, 50, "delayed", 30, 40, true));
  // Finished, but the student has not said how it went yet.
  past(T.midterm, -1, 0, 50, null);

  // Today, later than now: inside a window when one is left, otherwise soon.
  const laterToday = slotsForDay(0).find((start) => start > now + 15 * MINUTE);
  const todayStart = laterToday ?? ceilTo(now + 30 * MINUTE, 15);
  used.add(todayStart);
  addSession(T.problemSet, todayStart, 50);
  // Keeps the fallback session from being invalidated as "outside availability".
  if (!laterToday) sessions[sessions.length - 1].outsideWindows = true;

  const upcoming = (taskRef, offset, index, minutes) =>
    addSession(taskRef, takeSlot(offset, index, true), minutes);

  upcoming(T.problemSet, 1, 0, 50);
  upcoming(T.problemSet, 1, 1, 40);
  upcoming(T.bibliography, 1, 2, 50);
  upcoming(T.bibliography, 2, 0, 50);
  upcoming(T.bibliography, 2, 1, 20);
  upcoming(T.midterm, 3, 0, 50);
  upcoming(T.midterm, 3, 1, 50);
  upcoming(T.midterm, 4, 0, 50);
  upcoming(T.midterm, 5, 0, 50);
  upcoming(T.project, 6, 1, 50);
  upcoming(T.project, 7, 0, 50);
  upcoming(T.project, 8, 0, 50);
  upcoming(T.project, 9, 0, 50);
  upcoming(T.project, 10, 1, 50);

  sessions.sort((a, b) => a.startsAt - b.startsAt);
  // Completed tasks finish just after their last recorded session.
  for (const item of Object.values(T)) {
    if (item.completedAt === null) continue;
    const lastEnd = Math.max(...sessions.filter((s) => s.taskId === item.id).map((s) => s.endsAt));
    item.completedAt = lastEnd + 5 * MINUTE;
    item.updatedAt = item.completedAt;
  }

  return {
    signedIn: true,
    csrfToken: randomUUID().replaceAll("-", ""),
    account: {
      id: randomUUID(),
      email: "demo.student@example.com",
      name: "Demo Student",
      passwordSet: true,
    },
    password: DEMO_PASSWORD,
    preferences: {
      timezone: tz,
      preferred_session_length_minutes: 50,
      minimum_break_minutes: 10,
      availability_confirmation_required: false,
    },
    identities: [],
    deletionReady: false,
    tasks: Object.values(T),
    windows,
    periods,
    sessions,
    proposal: null,
    acknowledged: new Set(),
    adaptiveHistory: ADAPTIVE_HISTORY,
    estimationAccuracy: DEMO_ESTIMATION_ACCURACY,
    google: {
      calendarCheckedAt: null,
      classroomCheckedAt: now - 5 * 24 * 60 * MINUTE,
    },
  };
}

/** An account on its first visit: no study hours, tasks or plan yet. */
export function createNewStudentState(now = Date.now()) {
  return {
    ...createSeedState(now),
    signedIn: false,
    account: {
      id: randomUUID(),
      email: NEW_STUDENT_EMAIL,
      name: "New Student",
      passwordSet: true,
    },
    password: NEW_STUDENT_PASSWORD,
    tasks: [],
    windows: [],
    periods: [],
    sessions: [],
    adaptiveHistory: {},
    estimationAccuracy: null,
    google: { calendarCheckedAt: null, classroomCheckedAt: null },
  };
}
