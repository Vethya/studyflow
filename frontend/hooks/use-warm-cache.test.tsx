// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  listUnavailablePeriods: vi.fn(),
  getProfile: vi.fn(),
  getLinkedIdentities: vi.fn(),
}));
vi.mock("@/lib/api", () => ({
  availability: { listUnavailablePeriods: api.listUnavailablePeriods },
  account: { getProfile: api.getProfile, getLinkedIdentities: api.getLinkedIdentities },
}));

import { useWarmCache } from "./use-warm-cache";

function Probe({ accountId }: { accountId: string | null }) {
  useWarmCache(accountId);
  return null;
}

type Cache = Map<string, { data?: unknown }>;

function renderWith(accountId: string | null, cache: Cache = new Map()) {
  const ui = (id: string | null) => (
    <SWRConfig value={{ provider: () => cache as never }}>
      <Probe accountId={id} />
    </SWRConfig>
  );
  const view = render(ui(accountId));
  return { ...view, cache, switchTo: (id: string | null) => view.rerender(ui(id)) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestIdleCallback", undefined);
  api.listUnavailablePeriods.mockResolvedValue([]);
  api.getProfile.mockRejectedValue(new Error("offline"));
  api.getLinkedIdentities.mockResolvedValue([{ provider: "google" }]);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("useWarmCache", () => {
  it("does nothing until an account is signed in", () => {
    renderWith(null);
    vi.runAllTimers();
    expect(api.getProfile).not.toHaveBeenCalled();
  });

  it("fills missing resources after a short delay and skips cached ones", async () => {
    const { cache } = renderWith("alex", new Map([["studyflow/account/identities", { data: [] }]]));
    expect(api.getProfile).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(api.listUnavailablePeriods).toHaveBeenCalledTimes(1);
    expect(api.getProfile).toHaveBeenCalledTimes(1);
    expect(api.getLinkedIdentities).not.toHaveBeenCalled();
    expect(cache.get("studyflow/availability/unavailable-periods")?.data).toEqual([]);
    // A failed warm-up leaves the key for the page to fetch.
    expect(cache.get("studyflow/account/profile")?.data).toBeUndefined();
  });

  it("keeps a page's own answer that arrived while the warm-up was in flight", async () => {
    let resolve: (value: unknown) => void = () => {};
    api.getLinkedIdentities.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { cache } = renderWith("alex");
    await act(() => vi.advanceTimersByTimeAsync(500));
    cache.set("studyflow/account/identities", { data: ["page"] });
    await act(async () => resolve(["warm"]));
    expect(cache.get("studyflow/account/identities")?.data).toEqual(["page"]);
  });

  it("drops a warm-up still in flight when the account signs out", async () => {
    let resolve: (value: unknown) => void = () => {};
    api.getLinkedIdentities.mockReturnValue(new Promise((r) => { resolve = r; }));
    const view = renderWith("alex");
    await act(() => vi.advanceTimersByTimeAsync(500));
    const signal = api.getLinkedIdentities.mock.calls[0][0] as AbortSignal;
    view.switchTo(null);
    expect(signal.aborted).toBe(true);
    await act(async () => resolve(["alex's identities"]));
    expect(view.cache.get("studyflow/account/identities")).toBeUndefined();
  });

  it("uses idle time when the browser offers it and cancels on unmount", () => {
    const callbacks: Array<() => void> = [];
    const cancel = vi.fn();
    vi.stubGlobal("requestIdleCallback", (callback: () => void) => callbacks.push(callback));
    vi.stubGlobal("cancelIdleCallback", cancel);
    const view = renderWith("alex");
    expect(api.getLinkedIdentities).not.toHaveBeenCalled();
    callbacks[0]();
    expect(api.getLinkedIdentities).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(cancel).toHaveBeenCalledWith(1);
  });

  it("cancels the fallback timer on unmount", () => {
    renderWith("alex").unmount();
    vi.runAllTimers();
    expect(api.getProfile).not.toHaveBeenCalled();
  });
});
