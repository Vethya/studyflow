// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ resolvedTheme: "light" }));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: state.resolvedTheme }),
}));
vi.mock("sonner", () => ({
  Toaster: ({ theme, className }: { theme: string; className: string }) => (
    <div data-testid="sonner" data-theme={theme} className={className} />
  ),
}));

import { Checkbox } from "./checkbox";
import { Toaster } from "./sonner";

afterEach(() => {
  cleanup();
  state.resolvedTheme = "light";
});

describe("remaining UI primitives", () => {
  it("renders and toggles the Base UI checkbox", () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox aria-label="Accept" onCheckedChange={onCheckedChange} />);

    const checkbox = screen.getByRole("checkbox");
    expect(checkbox.getAttribute("data-slot")).toBe("checkbox");
    fireEvent.click(checkbox);
    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.anything());
  });

  it("maps light and non-light resolved themes into Sonner themes", () => {
    const { rerender } = render(<Toaster />);
    expect(screen.getByTestId("sonner").getAttribute("data-theme")).toBe("light");
    state.resolvedTheme = "dark";
    rerender(<Toaster />);
    expect(screen.getByTestId("sonner").getAttribute("data-theme")).toBe("dark");
  });
});
