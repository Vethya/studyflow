import { afterEach, expect, it, vi } from "vitest";

const { apiJsonMock } = vi.hoisted(() => ({ apiJsonMock: vi.fn() }));

vi.mock("./client", () => ({ apiJson: apiJsonMock }));

import { getPreferences, updatePreferences } from "./reminders";

const wire = {
  email_enabled: true,
  before_session_minutes: 30,
  after_session: false,
  email_verified: true,
  delivery_available: false,
};
const mapped = {
  emailEnabled: true,
  beforeSessionMinutes: 30,
  afterSession: false,
  emailVerified: true,
  deliveryAvailable: false,
};

afterEach(() => apiJsonMock.mockReset());

it("reads reminder preferences into camelCase", async () => {
  apiJsonMock.mockResolvedValue(wire);
  const signal = new AbortController().signal;

  await expect(getPreferences(signal)).resolves.toEqual(mapped);
  expect(apiJsonMock).toHaveBeenCalledWith("/reminders/preferences", { signal });
});

it("sends every editable field on update", async () => {
  apiJsonMock.mockResolvedValue({ ...wire, before_session_minutes: 60 });

  await expect(
    updatePreferences({ emailEnabled: true, beforeSessionMinutes: 60, afterSession: false }),
  ).resolves.toEqual({ ...mapped, beforeSessionMinutes: 60 });
  expect(apiJsonMock).toHaveBeenCalledWith("/reminders/preferences", {
    method: "PUT",
    body: { email_enabled: true, before_session_minutes: 60, after_session: false },
    signal: undefined,
  });
});
