import type { OutcomeFormData } from "@/types/session";

export type WireSessionOutcomeRequest =
  | {
      outcome: "completed";
      actual_minutes: number;
      large_actual_confirmed: boolean;
    }
  | {
      outcome: "delayed";
      actual_minutes: number;
      remaining_minutes: number;
      large_actual_confirmed: boolean;
    }
  | { outcome: "missed" };

export function withLargeActualConfirmation(data: OutcomeFormData): OutcomeFormData {
  return { ...data, largeActualConfirmed: true };
}

export function toWireOutcome(
  data: OutcomeFormData,
  largeActualConfirmed: boolean,
): WireSessionOutcomeRequest {
  switch (data.outcome) {
    case "Completed":
      return {
        outcome: "completed",
        actual_minutes: data.actualMinutes,
        large_actual_confirmed: largeActualConfirmed,
      };
    case "Delayed":
      if (data.revisedRemainingMinutes === undefined) {
        throw new Error("Delayed outcomes require remaining minutes");
      }
      return {
        outcome: "delayed",
        actual_minutes: data.actualMinutes,
        remaining_minutes: data.revisedRemainingMinutes,
        large_actual_confirmed: largeActualConfirmed,
      };
    case "Missed":
      return { outcome: "missed" };
    default: {
      const exhaustiveOutcome: never = data.outcome;
      throw new Error(`Unsupported session outcome: ${exhaustiveOutcome}`);
    }
  }
}
