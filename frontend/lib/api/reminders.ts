import { apiJson } from "./client";

export interface ReminderPreferences {
  emailEnabled: boolean;
  /** 0 turns the before-session email off; otherwise 10–120. */
  beforeSessionMinutes: number;
  afterSession: boolean;
  /** Read-only: reminders only go to a verified address. */
  emailVerified: boolean;
  /** Read-only: false when this server has no reminder schedule configured. */
  deliveryAvailable: boolean;
}

interface WireReminderPreferences {
  email_enabled: boolean;
  before_session_minutes: number;
  after_session: boolean;
  email_verified: boolean;
  delivery_available: boolean;
}

export type ReminderPreferencesInput = Pick<ReminderPreferences, "emailEnabled" | "beforeSessionMinutes" | "afterSession">;

function toReminderPreferences(wire: WireReminderPreferences): ReminderPreferences {
  return {
    emailEnabled: wire.email_enabled,
    beforeSessionMinutes: wire.before_session_minutes,
    afterSession: wire.after_session,
    emailVerified: wire.email_verified,
    deliveryAvailable: wire.delivery_available,
  };
}

export async function getPreferences(signal?: AbortSignal): Promise<ReminderPreferences> {
  return toReminderPreferences(await apiJson<WireReminderPreferences>("/reminders/preferences", { signal }));
}

/** The backend requires all three fields on every update. */
export async function updatePreferences(input: ReminderPreferencesInput, signal?: AbortSignal): Promise<ReminderPreferences> {
  const wire = await apiJson<WireReminderPreferences>("/reminders/preferences", {
    method: "PUT",
    body: {
      email_enabled: input.emailEnabled,
      before_session_minutes: input.beforeSessionMinutes,
      after_session: input.afterSession,
    },
    signal,
  });
  return toReminderPreferences(wire);
}
