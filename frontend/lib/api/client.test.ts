// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { apiJson, apiVoid, ApiError, buildQuery, readCsrfToken } from "./client";

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

it("builds queries while omitting empty values", () => {
  expect(buildQuery({ page: 2, active: false, empty: "", missing: undefined, none: null })).toBe(
    "?page=2&active=false",
  );
  expect(buildQuery({})).toBe("");
});

it("reads the host-prefixed and development CSRF cookies", () => {
  document.cookie = "studyflow_csrf=dev%20token";
  expect(readCsrfToken()).toBe("dev token");

  vi.stubGlobal("document", { cookie: "__Host-studyflow_csrf=host-token" });
  expect(readCsrfToken()).toBe("host-token");
});

it("returns null when the browser document is unavailable", () => {
  vi.stubGlobal("document", undefined);
  expect(readCsrfToken()).toBeNull();
});

it("sends JSON, cookies, CSRF, and mutation notifications on a successful request", async () => {
  const fetchMock = vi.fn(async () => Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
  document.cookie = "studyflow_csrf=csrf-token";
  const changed = vi.fn();
  window.addEventListener("studyflow:data-changed", changed);
  const signal = new AbortController().signal;

  await expect(apiJson("/tasks", { method: "POST", body: { title: "Read" }, signal })).resolves.toEqual({ ok: true });

  expect(fetchMock).toHaveBeenCalledWith("/api/v1/tasks", expect.objectContaining({
    method: "POST",
    credentials: "include",
    cache: "no-store",
    body: JSON.stringify({ title: "Read" }),
    signal,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-CSRF-Token": "csrf-token",
    },
  }));
  expect(changed).toHaveBeenCalledOnce();
  expect(changed.mock.calls[0][0].detail).toEqual({ path: "/tasks", method: "POST" });
  window.removeEventListener("studyflow:data-changed", changed);
});

it("supports CSRF-free requests and suppresses mutation notifications when requested", async () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  const changed = vi.fn();
  window.addEventListener("studyflow:data-changed", changed);

  await apiVoid("/auth/logout", { method: "POST", csrf: false });
  await apiVoid("/schedule-proposals/simulate", {
    method: "POST",
    body: { scenario: {} },
    notifyDataChanged: false,
  });

  expect(fetchMock).toHaveBeenNthCalledWith(
    1,
    "/api/v1/auth/logout",
    expect.objectContaining({ headers: { Accept: "application/json" } }),
  );
  expect(changed).not.toHaveBeenCalled();
  window.removeEventListener("studyflow:data-changed", changed);
});

it("exposes the HTTP status helpers on ApiError", () => {
  expect(new ApiError(401, "signed out")).toMatchObject({
    isUnauthenticated: true,
    isForbidden: false,
    isNotFound: false,
    isValidation: false,
    isRateLimited: false,
  });
  expect(new ApiError(403, "forbidden").isForbidden).toBe(true);
  expect(new ApiError(404, "missing").isNotFound).toBe(true);
  expect(new ApiError(422, "invalid").isValidation).toBe(true);
  expect(new ApiError(429, "slow down").isRateLimited).toBe(true);
});

it("maps validation details, retry headers, and field locations", async () => {
  vi.stubGlobal("fetch", async () =>
    new Response(JSON.stringify({ detail: [
      { loc: ["body", "password"], msg: "Too short" },
      { loc: ["body"], msg: "Bad body" },
      { loc: ["body", "password"], msg: "Second password error" },
      { loc: ["query", 1], msg: "Query error" },
      { loc: ["body", "ignored"], msg: 42 },
    ] }), {
      status: 422,
      headers: { "Retry-After": "60" },
    }),
  );

  await expect(apiJson("/tasks")).rejects.toMatchObject({
    detail: "Too short. Bad body. Second password error. Query error",
    retryAfterSeconds: 60,
    fieldErrors: { password: "Too short" },
  });
});

it("handles structured and non-JSON error bodies", async () => {
  vi.stubGlobal("fetch", async () =>
    Response.json({ detail: { message: "Conflict" } }, { status: 409 }),
  );
  await expect(apiJson("/tasks")).rejects.toMatchObject({ detail: "Conflict", code: null });

  vi.stubGlobal("fetch", async () =>
    new Response("not json", { status: 500, statusText: "Server unavailable" }),
  );
  await expect(apiJson("/tasks")).rejects.toMatchObject({
    detail: "Server unavailable",
    retryAfterSeconds: null,
  });

  vi.stubGlobal("fetch", async () =>
    Response.json({ detail: [] }, { status: 400 }),
  );
  await expect(apiJson("/tasks")).rejects.toMatchObject({ detail: "Request failed with status 400" });

  vi.stubGlobal("fetch", async () => Response.json({}, { status: 400 }));
  await expect(apiJson("/tasks")).rejects.toMatchObject({ detail: "Request failed with status 400" });

  vi.stubGlobal("fetch", async () => new Response(null, { status: 500 }));
  await expect(apiJson("/tasks")).rejects.toMatchObject({ detail: "Request failed with status 500" });
});

it("invalidates the session only for protected 401 responses", async () => {
  const protectedInvalidated = vi.fn();
  window.addEventListener("studyflow:session-invalidated", protectedInvalidated);
  vi.stubGlobal("fetch", async () => Response.json({ detail: "expired" }, { status: 401 }));

  await expect(apiJson("/tasks")).rejects.toBeInstanceOf(ApiError);
  expect(protectedInvalidated).toHaveBeenCalledOnce();
  protectedInvalidated.mockReset();

  await expect(apiJson("/auth/session")).rejects.toBeInstanceOf(ApiError);
  expect(protectedInvalidated).not.toHaveBeenCalled();
  window.removeEventListener("studyflow:session-invalidated", protectedInvalidated);
});
