// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { SIGNUP_EMAIL_TTL_MS, forgetSignupEmail, readSignupEmail, rememberSignupEmail } from "./signup-email";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

it("remembers, reads and forgets the registration address", () => {
  expect(readSignupEmail()).toBeNull();
  rememberSignupEmail("student@example.com");
  expect(readSignupEmail()).toBe("student@example.com");
  forgetSignupEmail();
  expect(readSignupEmail()).toBeNull();
});

it("drops an address left too long, or stored without an expiry", () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  rememberSignupEmail("student@example.com");
  now.mockReturnValue(1_000_000 + SIGNUP_EMAIL_TTL_MS - 1);
  expect(readSignupEmail()).toBe("student@example.com");
  now.mockReturnValue(1_000_000 + SIGNUP_EMAIL_TTL_MS);
  expect(readSignupEmail()).toBeNull();
  expect(window.localStorage.getItem("studyflow:signup-email")).toBeNull();

  for (const stale of ["old@example.com", "null", JSON.stringify({ email: "x@example.com" })]) {
    window.localStorage.setItem("studyflow:signup-email", stale);
    expect(readSignupEmail()).toBeNull();
  }
});

it("carries on quietly when storage is unavailable", () => {
  const refuse = () => {
    throw new Error("storage disabled");
  };
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(refuse);
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(refuse);
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(refuse);
  expect(() => rememberSignupEmail("student@example.com")).not.toThrow();
  expect(readSignupEmail()).toBeNull();
  expect(() => forgetSignupEmail()).not.toThrow();
});
