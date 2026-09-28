/**
 * Conversions between `<input type="datetime-local">` values and the RFC 3339
 * timestamps the backend requires.
 *
 * The API rejects any deadline without an explicit UTC offset, and a
 * datetime-local input produces a bare wall-clock string, so the two never
 * cross the boundary unconverted.
 */

import { TZDate } from "@date-fns/tz";

export type DateValue = string | number | Date;

/** View an absolute instant through the account's configured timezone. */
export function inTimeZone(value: DateValue, timeZone: string): TZDate {
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return new TZDate(timestamp, timeZone);
}

/** `"2026-08-30T23:59"` in the account zone → an explicit UTC instant. */
export function localInputToIso(value: string, timeZone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new RangeError("Invalid datetime-local value.");
  const [, year, month, day, hour, minute] = match.map(Number);
  const instant = new TZDate(year, month - 1, day, hour, minute, timeZone);
  return new Date(instant.getTime()).toISOString();
}

/** An absolute instant → a datetime-local value in the account zone. */
export function isoToLocalInput(value: string, timeZone: string): string {
  const date = inTimeZone(value, timeZone);
  const part = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}T${part(date.getHours())}:${part(date.getMinutes())}`;
}

/** The current wall-clock time, formatted for a datetime-local input's `min`. */
export function nowLocalInput(timeZone: string): string {
  return isoToLocalInput(new Date().toISOString(), timeZone);
}

/**
 * One vocabulary for deadlines across the whole product.
 *
 * The Tasks ledger used to say "3 days" while the Dashboard said "in 2d" and
 * the Calendar agenda said "Wed, Aug 26" — three phrasings of one fact, so a
 * student could not carry a sense of urgency from one screen to the next.
 *
 * `urgent` is what earns the deficit colour: due inside two days, or already
 * past. It is always paired with an icon or a word, never colour alone.
 */
export interface DeadlinePhrase {
  /** Short form for dense rows and columns. */
  short: string;
  /** Spoken form for headings, callouts and screen readers. */
  long: string;
  overdue: boolean;
  urgent: boolean;
}

export function describeDeadline(
  deadline: string | Date,
  timeZone: string,
  now = new Date(),
): DeadlinePhrase {
  const due = typeof deadline === "string" ? new Date(deadline) : deadline;
  const todayKey = dayKey(now, timeZone);
  const dueKey = dayKey(due, timeZone);
  const [todayYear, todayMonth, todayDay] = todayKey.split("-").map(Number);
  const [dueYear, dueMonth, dueDay] = dueKey.split("-").map(Number);

  // Whole calendar days apart, so "tomorrow" means tomorrow regardless of the
  // clock — a deadline at 23:59 tonight is "today", not "in 9 hours".
  const days = Math.round(
    (Date.UTC(dueYear, dueMonth - 1, dueDay) - Date.UTC(todayYear, todayMonth - 1, todayDay)) /
      86_400_000,
  );
  const date = formatDate(due, timeZone, { day: "numeric", month: "short" });

  if (due.getTime() < now.getTime()) {
    const over = Math.max(1, Math.abs(days));
    return {
      short: days === 0 ? "Overdue" : `${over}d over`,
      long: days === 0 ? "Overdue today" : `${over} ${over === 1 ? "day" : "days"} overdue`,
      overdue: true,
      urgent: true,
    };
  }
  if (days === 0) return { short: "Today", long: "Due today", overdue: false, urgent: true };
  if (days === 1) return { short: "Tomorrow", long: "Due tomorrow", overdue: false, urgent: true };
  if (days <= 6) {
    return {
      short: `${days}d`,
      long: `Due in ${days} days`,
      overdue: false,
      urgent: days <= 2,
    };
  }
  return { short: date, long: `Due ${date}`, overdue: false, urgent: false };
}

/** `"23:59"` — 24-hour and fixed width, so it never wraps in a table column. */
export function formatClock(value: string | Date, timeZone: string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  });
}

export function formatDate(
  value: DateValue,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleDateString(undefined, { ...options, timeZone });
}

export function formatDateTime(
  value: DateValue,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString(undefined, { ...options, timeZone });
}

/** Account-local date key, `YYYY-MM-DD`. */
export function dayKey(value: DateValue, timeZone: string): string {
  const date = inTimeZone(value, timeZone);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function minutesSinceMidnight(value: DateValue, timeZone: string): number {
  const date = inTimeZone(value, timeZone);
  return date.getHours() * 60 + date.getMinutes();
}

export function startOfZonedDay(value: DateValue, timeZone: string): TZDate {
  const date = inTimeZone(value, timeZone);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function addZonedDays(value: DateValue, days: number, timeZone: string): TZDate {
  const date = inTimeZone(value, timeZone);
  date.setDate(date.getDate() + days);
  return date;
}

export function zonedCalendarDate(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): TZDate {
  return new TZDate(year, month, day, timeZone);
}

/** `"7am"`, `"12pm"`, `"9pm"` — the one hour label used by every time grid. */
export function formatHour(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  if (h === 0) return "12am";
  if (h === 12) return "12pm";
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}
