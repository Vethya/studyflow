import { clearFocusTimer } from "./focus-timer";
import { clearSignedInOnboarding } from "./onboarding";
import { resetSeenReminders } from "./reminders";

/**
 * Drops browser state that belongs to the signed-in student. Appearance
 * (theme, density) and the pre-login signup email stay, because they are not
 * that account's data.
 */
export function clearPerUserStorage(): void {
  clearFocusTimer();
  resetSeenReminders();
  clearSignedInOnboarding();
}

let accountDeleted = false;

/** Remember a deletion until the signed-out redirect can explain it. */
export function markAccountDeleted(): void {
  accountDeleted = true;
}

/** Read and clear the deletion marker. False when this sign-out was ordinary. */
export function consumeAccountDeleted(): boolean {
  const deleted = accountDeleted;
  accountDeleted = false;
  return deleted;
}
