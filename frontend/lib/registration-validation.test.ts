import { afterEach, expect, it, vi } from "vitest";
import { apiJson } from "@/lib/api/client";
import { ApiError } from "@/lib/api";
import { registrationFieldErrorsFrom, validateRegistration } from "./registration-validation";

afterEach(() => vi.unstubAllGlobals());

it("reports each invalid registration field separately (FR-01-AC02)", () => {
  expect(validateRegistration({ name: "  ", password: "short", confirm: "" })).toEqual({
    name: "Enter your name.",
    password: "Use at least 12 characters.",
    confirm: "Enter your password again.",
  });
  expect(
    validateRegistration({ name: "Alex", password: "a long passphrase", confirm: "different one" }),
  ).toEqual({ confirm: "Passwords do not match." });
  expect(
    validateRegistration({ name: "Alex", password: "a long passphrase", confirm: "a long passphrase" }),
  ).toEqual({});
});

it("keeps FastAPI validation messages keyed by field", async () => {
  vi.stubGlobal("fetch", async () =>
    Response.json(
      {
        detail: [
          { loc: ["body", "name"], msg: "Name is required" },
          { loc: ["body", "password"], msg: "String should have at least 12 characters" },
        ],
      },
      { status: 422 },
    ),
  );
  const error = await apiJson("/auth/complete-registration").catch((cause: unknown) => cause);

  expect(error).toBeInstanceOf(ApiError);
  expect(registrationFieldErrorsFrom(error)).toEqual({
    name: "Name is required",
    password: "String should have at least 12 characters",
  });
});

it("puts the password policy rejection on the password field", () => {
  const error = new ApiError(422, "Password is not allowed");
  expect(registrationFieldErrorsFrom(error)?.password).toMatch(/not allowed/);
  expect(registrationFieldErrorsFrom(new ApiError(400, "Signup token is invalid or expired"))).toBeNull();
});
