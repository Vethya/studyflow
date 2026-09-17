// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { apiJson } from "./client";
import { STUDYFLOW_SESSION_INVALIDATED_EVENT } from "@/lib/data-events";

afterEach(() => vi.unstubAllGlobals());

it("notifies the session provider when a protected request returns 401", async () => {
  const onSessionInvalidated = vi.fn();
  window.addEventListener(STUDYFLOW_SESSION_INVALIDATED_EVENT, onSessionInvalidated);
  vi.stubGlobal("fetch", async () => Response.json({ detail: "Not authenticated" }, { status: 401 }));

  await expect(apiJson("/dashboard-data")).rejects.toMatchObject({
    status: 401,
    detail: "Not authenticated",
  });

  expect(onSessionInvalidated).toHaveBeenCalledOnce();
  window.removeEventListener(STUDYFLOW_SESSION_INVALIDATED_EVENT, onSessionInvalidated);
});
