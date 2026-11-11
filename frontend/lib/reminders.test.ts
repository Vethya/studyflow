// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { elapsed, markRemindersSeen, noSeenReminders, resetSeenReminders, seenReminders, subscribeToSeenReminders } from "./reminders";

beforeEach(() => resetSeenReminders());
afterEach(() => vi.restoreAllMocks());

describe("elapsed", () => {
  const now = Date.parse("2026-10-18T12:00:00Z");
  it("rounds to minutes, hours and days and never goes below a minute", () => {
    expect(elapsed("2026-10-18T12:00:20Z", now)).toBe("1m");
    expect(elapsed("2026-10-18T11:15:00Z", now)).toBe("45m");
    expect(elapsed("2026-10-18T07:00:00Z", now)).toBe("5h");
    expect(elapsed("2026-10-17T10:00:00Z", now)).toBe("1 day");
    expect(elapsed("2026-10-14T12:00:00Z", now)).toBe("4 days");
  });
});

describe("seen reminders", () => {
  it("reads what is stored, keeps the same snapshot, and notifies on change", () => {
    window.localStorage.setItem("studyflow:reminders-seen", JSON.stringify(["a", 3, "b"]));
    const first = seenReminders();
    expect([...first]).toEqual(["a", "b"]);
    expect(seenReminders()).toBe(first);
    expect(noSeenReminders().size).toBe(0);

    const listener = vi.fn();
    const unsubscribe = subscribeToSeenReminders(listener);
    markRemindersSeen(["c", "c", "a"]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect([...seenReminders()]).toEqual(["a", "c"]);
    expect(window.localStorage.getItem("studyflow:reminders-seen")).toBe('["a","c"]');
    unsubscribe();
    markRemindersSeen([]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("treats broken or unexpected storage as nothing seen", () => {
    window.localStorage.setItem("studyflow:reminders-seen", "{not json");
    expect(seenReminders().size).toBe(0);
    window.localStorage.setItem("studyflow:reminders-seen", '{"a":1}');
    expect(seenReminders().size).toBe(0);
    window.localStorage.removeItem("studyflow:reminders-seen");
    expect(seenReminders().size).toBe(0);
  });

  it("keeps working when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(seenReminders().size).toBe(0);
    markRemindersSeen(["x"]);
    expect([...seenReminders()]).toEqual(["x"]);
    resetSeenReminders();
    expect(seenReminders().size).toBe(0);
  });
});
