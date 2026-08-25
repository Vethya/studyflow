/**
 * Conversions between `<input type="datetime-local">` values and the RFC 3339
 * timestamps the backend requires.
 *
 * The API rejects any deadline without an explicit UTC offset, and a
 * datetime-local input produces a bare wall-clock string, so the two never
 * cross the boundary unconverted.
 */

/** `"2026-08-30T23:59"` in the browser's zone → `"2026-08-30T16:59:00.000Z"`. */
export function localInputToIso(value: string): string {
  return new Date(value).toISOString();
}

/** `"2026-08-30T16:59:00Z"` → `"2026-08-30T23:59"` in the browser's zone. */
export function isoToLocalInput(value: string): string {
  const date = new Date(value);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

/** The current wall-clock time, formatted for a datetime-local input's `min`. */
export function nowLocalInput(): string {
  return isoToLocalInput(new Date().toISOString());
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

export function describeDeadline(deadline: string | Date, now = new Date()): DeadlinePhrase {
  const due = typeof deadline === "string" ? new Date(deadline) : deadline;
  const dayMs = 86_400_000;

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfDue = new Date(due);
  startOfDue.setHours(0, 0, 0, 0);

  // Whole calendar days apart, so "tomorrow" means tomorrow regardless of the
  // clock — a deadline at 23:59 tonight is "today", not "in 9 hours".
  const days = Math.round((startOfDue.getTime() - startOfToday.getTime()) / dayMs);
  const date = due.toLocaleDateString(undefined, { day: "numeric", month: "short" });

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
export function formatClock(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** `"7am"`, `"12pm"`, `"9pm"` — the one hour label used by every time grid. */
export function formatHour(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  if (h === 0) return "12am";
  if (h === 12) return "12pm";
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}
