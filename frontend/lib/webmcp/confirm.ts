/**
 * In-page confirmation for destructive WebMCP actions (#64).
 *
 * A `confirmed: true` input flag only proves that the agent typed it, and the
 * agent may be following instructions hidden in task titles, notes, or
 * imported Classroom and Calendar text. These actions therefore ask the student
 * directly in the page, through the browser's own modal dialog, which a WebMCP
 * tool call cannot answer.
 *
 * Known limit: an agent that also drives the browser (CDP, Playwright, an
 * extension) can accept the dialog, and a script already running in the page
 * can replace `window.confirm`. Such a script could call the API directly
 * anyway; the Content-Security-Policy is the defense against it.
 */

export interface ConfirmationRequest {
  /** Short imperative description, e.g. `Delete the task "Essay"`. */
  action: string;
  /** What happens if the student agrees. */
  consequence: string;
}

/** Resolves true only when the student approved the action in the page. */
export type ConfirmAction = (request: ConfirmationRequest) => boolean | Promise<boolean>;

/** Optional WebMCP hook that pauses the agent while the page asks the user. */
export type RequestUserInteraction = <T>(callback: () => Promise<T>) => Promise<T>;

const CONTROL_CHARACTERS =
  /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;

/** One short line for a confirmation dialog. Untrusted text cannot add lines or bidi marks. */
export function confirmationLabel(value: string, fallback: string): string {
  const singleLine = value.replace(CONTROL_CHARACTERS, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return singleLine.length > 0 ? singleLine : fallback;
}

export function browserConfirm(request: ConfirmationRequest): boolean {
  if (typeof window === "undefined" || typeof window.confirm !== "function") return false;
  return window.confirm(
    `An AI assistant wants to: ${request.action}.\n\n${request.consequence}\n\nAllow this?`,
  );
}

export async function requireUserConfirmation(
  request: ConfirmationRequest,
  confirm: ConfirmAction,
  requestUserInteraction?: RequestUserInteraction,
): Promise<void> {
  let asked = false;
  let approved = false;
  const ask = async () => {
    asked = true;
    approved = (await confirm(request)) === true;
    return approved;
  };
  if (requestUserInteraction) {
    // The hook may pause the agent. Its return value is not approval.
    await requestUserInteraction(ask);
  } else {
    await ask();
  }
  if (!asked || !approved) {
    throw new Error(`The student did not approve: ${request.action}. Nothing was changed.`);
  }
}
