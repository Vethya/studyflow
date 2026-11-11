// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.doUnmock("react");
  vi.resetModules();
});

describe("PageTransition", () => {
  it("swaps pages plainly when React has no ViewTransition", async () => {
    const { PageTransition } = await import("./page-transition");
    const { rerender } = render(<PageTransition id="/a"><p>first</p></PageTransition>);
    expect(screen.getByText("first").parentElement?.className).toBe("h-full");
    rerender(<PageTransition id="/b"><p>second</p></PageTransition>);
    expect(screen.getByText("second")).toBeTruthy();
  });

  it("wraps the page in a ViewTransition when React provides one", async () => {
    vi.resetModules();
    vi.doMock("react", async () => {
      const actual = await vi.importActual<typeof import("react")>("react");
      const ViewTransition = ({ children, enter, exit }: { children: React.ReactNode; enter: string; exit: string }) =>
        actual.createElement("section", { "data-enter": enter, "data-exit": exit }, children);
      return { ...actual, default: actual, ViewTransition };
    });
    const { PageTransition } = await import("./page-transition");
    render(<PageTransition id="/a"><p>page</p></PageTransition>);
    const wrapper = screen.getByText("page").closest("section");
    expect(wrapper?.getAttribute("data-enter")).toBe("page-enter");
    expect(wrapper?.getAttribute("data-exit")).toBe("page-exit");
  });
});
