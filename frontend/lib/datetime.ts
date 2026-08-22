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
