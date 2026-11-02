// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { isMacPlatform, isShortcutBlocked } from "./shortcuts";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("shortcuts", () => {
  it("blocks shortcuts while typing or inside overlays", () => {
    expect(isShortcutBlocked(null)).toBe(false);
    expect(isShortcutBlocked(window)).toBe(false);

    const editable = document.createElement("div");
    Object.defineProperty(editable, "isContentEditable", { value: true });
    expect(isShortcutBlocked(editable)).toBe(true);

    for (const tag of ["input", "textarea", "select"]) {
      expect(isShortcutBlocked(document.createElement(tag))).toBe(true);
    }

    for (const role of ["dialog", "alertdialog", "menu", "listbox"]) {
      const container = document.createElement("div");
      container.setAttribute("role", role);
      const button = document.createElement("button");
      container.append(button);
      document.body.append(container);
      expect(isShortcutBlocked(button)).toBe(true);
    }

    const plain = document.createElement("button");
    document.body.append(plain);
    expect(isShortcutBlocked(plain)).toBe(false);
  });

  it("detects Apple platforms", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)" });
    expect(isMacPlatform()).toBe(true);
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0)" });
    expect(isMacPlatform()).toBe(false);
    vi.stubGlobal("navigator", undefined);
    expect(isMacPlatform()).toBe(false);
  });
});
