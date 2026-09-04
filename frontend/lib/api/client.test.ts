import { afterEach, expect, it, vi } from "vitest";
import { apiJson, ApiError } from "./client";

afterEach(() => vi.unstubAllGlobals());

it.each([
  [409, "Original estimate is frozen after work starts", "Original estimate is frozen after work starts", null],
  [422, [{ msg: "Too small" }, { msg: "Required" }], "Too small. Required", null],
  [409, { code: "adaptive_estimate_conflict", message: "Refresh and retry" }, "Refresh and retry", "adaptive_estimate_conflict"],
])("preserves handled error text and optional machine codes (%s)", async (status, detail, message, code) => {
  vi.stubGlobal("fetch", async () => Response.json({ detail }, { status: status as number }));
  const error = await apiJson("/tasks").catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ status, detail: message, message, code });
});
