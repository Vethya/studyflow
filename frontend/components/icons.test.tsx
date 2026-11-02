// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Plus, Sparkles } from "./icons";

afterEach(cleanup);

describe("icons", () => {
  it("hides decorative glyphs from assistive technology", () => {
    const { container } = render(<Plus className="size-4" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("class")).toBe("hgi size-4");
    expect(Plus.displayName).toBe("Plus");
  });

  it("exposes a glyph once the caller names it", () => {
    render(<Sparkles aria-label="Adaptive estimate" />);
    const svg = screen.getByLabelText("Adaptive estimate");
    expect(svg.getAttribute("aria-hidden")).toBeNull();
  });
});
