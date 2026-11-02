// @vitest-environment jsdom
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readDensity, setDensity, useDensity } from "./density";
import { DENSITY_BOOT_SCRIPT, DENSITY_STORAGE_KEY } from "./density-script";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  delete document.documentElement.dataset.density;
});

describe("density", () => {
  it("reads and writes the stored density", () => {
    expect(readDensity()).toBe("comfortable");
    setDensity("compact");
    expect(window.localStorage.getItem(DENSITY_STORAGE_KEY)).toBe("compact");
    expect(document.documentElement.dataset.density).toBe("compact");
    expect(readDensity()).toBe("compact");
    setDensity("comfortable");
    expect(document.documentElement.dataset.density).toBeUndefined();
    expect(readDensity()).toBe("comfortable");
  });

  it("falls back when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(readDensity()).toBe("comfortable");
    setDensity("compact");
    expect(document.documentElement.dataset.density).toBe("compact");
  });

  it("follows local changes and other tabs, ignoring unrelated keys", () => {
    const { result, unmount } = renderHook(() => useDensity());
    expect(result.current).toBe("comfortable");
    act(() => setDensity("compact"));
    expect(result.current).toBe("compact");

    window.localStorage.setItem(DENSITY_STORAGE_KEY, "comfortable");
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: "other" })); });
    expect(document.documentElement.dataset.density).toBe("compact");
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: DENSITY_STORAGE_KEY })); });
    expect(result.current).toBe("comfortable");
    expect(document.documentElement.dataset.density).toBeUndefined();
    unmount();
  });

  it("renders comfortable on the server", () => {
    function Probe() { return createElement("span", null, useDensity()); }
    expect(renderToString(createElement(Probe))).toContain("comfortable");
  });

  it("boot script applies compact density", () => {
    window.localStorage.setItem(DENSITY_STORAGE_KEY, "compact");
    new Function(DENSITY_BOOT_SCRIPT)();
    expect(document.documentElement.dataset.density).toBe("compact");
  });
});
