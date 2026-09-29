// @vitest-environment jsdom
import React from "react";
import { renderToString } from "react-dom/server";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setTheme: vi.fn(),
  applyTheme: vi.fn(),
  theme: "system" as string | null,
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: mocks.theme, setTheme: mocks.setTheme }),
}));
vi.mock("@/lib/theme", () => ({ applyThemeWithTransition: mocks.applyTheme }));
vi.mock("./ui/select", () => ({
  Select: ({ children, onValueChange }: { children: React.ReactNode; onValueChange?: (value: string | null) => void }) => (
    <div><button type="button" onClick={() => onValueChange?.("dark")}>Choose dark</button><button type="button" onClick={() => onValueChange?.("")}>Choose none</button>{children}</div>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children, ...props }: { children: React.ReactNode }) => <button type="button" {...props}>{children}</button>,
  SelectValue: ({ children }: { children: React.ReactNode }) => <span>{typeof children === "function" ? children("unknown") : children}</span>,
}));

import { ThemeSelector } from "./theme-selector";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.theme = "system";
});

describe("ThemeSelector coverage", () => {
  it("renders the server skeleton and applies a selected theme", () => {
    expect(renderToString(<ThemeSelector />)).toContain("data-slot=\"skeleton\"");
    render(<ThemeSelector />);
    fireEvent.click(screen.getByRole("button", { name: "Choose dark" }));
    expect(mocks.applyTheme).toHaveBeenCalledWith("dark", mocks.setTheme);
    fireEvent.click(screen.getByRole("button", { name: "Choose none" }));
    expect(mocks.applyTheme).toHaveBeenCalledTimes(1);
    cleanup();
    mocks.theme = null;
    render(<ThemeSelector />);
    expect(screen.getAllByText("System").length).toBeGreaterThan(0);
  });
});
