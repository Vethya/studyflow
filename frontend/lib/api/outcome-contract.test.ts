import { describe, expect, it } from "vitest";
import { toWireOutcome } from "./outcome-contract";

describe("toWireOutcome", () => {
  it("maps Completed outcomes with the retry confirmation flag", () => {
    expect(toWireOutcome({ outcome: "Completed", actualMinutes: 75 }, true)).toEqual({
      outcome: "completed",
      actual_minutes: 75,
      large_actual_confirmed: true,
    });
  });

  it("maps Delayed outcomes with revised remaining minutes", () => {
    expect(
      toWireOutcome(
        { outcome: "Delayed", actualMinutes: 30, revisedRemainingMinutes: 45 },
        false,
      ),
    ).toEqual({
      outcome: "delayed",
      actual_minutes: 30,
      remaining_minutes: 45,
      large_actual_confirmed: false,
    });
  });

  it("maps Missed outcomes without duration fields", () => {
    expect(toWireOutcome({ outcome: "Missed", actualMinutes: 0 }, false)).toEqual({
      outcome: "missed",
    });
  });

  it("rejects Delayed outcomes without revised remaining minutes", () => {
    expect(() =>
      toWireOutcome({ outcome: "Delayed", actualMinutes: 30 }, false),
    ).toThrow("Delayed outcomes require remaining minutes");
  });
});
