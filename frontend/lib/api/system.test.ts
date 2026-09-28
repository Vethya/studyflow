import { afterEach, expect, it, vi } from "vitest";
import { getHealth, getReadiness } from "./system";

afterEach(() => vi.unstubAllGlobals());

it("loads the liveness report", async () => {
  const fetchMock = vi.fn(async () => Response.json({ service: "studyflow-api", status: "ok", version: "1.0.0" }));
  vi.stubGlobal("fetch", fetchMock);

  await expect(getHealth()).resolves.toEqual({ service: "studyflow-api", status: "ok", version: "1.0.0" });
  expect(fetchMock).toHaveBeenCalledWith("/api/v1/health", expect.objectContaining({ method: "GET" }));
});

it("loads readiness and preserves dependency failures as API errors", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ service: "studyflow-api", status: "ready", database: "reachable" })));
  await expect(getReadiness()).resolves.toMatchObject({ status: "ready", database: "reachable" });

  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ detail: "Database unavailable" }, { status: 503 })));
  await expect(getReadiness()).rejects.toMatchObject({ status: 503, detail: "Database unavailable" });
});
