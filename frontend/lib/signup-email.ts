/**
 * The address a student registered with, kept briefly so the login form can
 * fill it in after they verify. The verification link often opens in a new
 * tab, so this lives in localStorage rather than in the URL or memory.
 *
 * It expires: on a shared computer, an address left behind by someone who
 * never came back to sign in would otherwise pre-fill the next person's form.
 */
const KEY = "studyflow:signup-email";
export const SIGNUP_EMAIL_TTL_MS = 60 * 60 * 1000;

export function rememberSignupEmail(email: string): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ email, savedAt: Date.now() }));
  } catch {
    // Private browsing can refuse storage; the student just types it again.
  }
}

export function readSignupEmail(): string | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let saved: { email?: unknown; savedAt?: unknown } | null = null;
  try {
    saved = JSON.parse(raw);
  } catch {
    // Written by an older version without an expiry: treat it as expired.
  }
  const fresh =
    typeof saved?.email === "string" &&
    typeof saved.savedAt === "number" &&
    Date.now() - saved.savedAt < SIGNUP_EMAIL_TTL_MS;
  if (!fresh) {
    forgetSignupEmail();
    return null;
  }
  return saved!.email as string;
}

export function forgetSignupEmail(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to clean up when storage is unavailable.
  }
}
