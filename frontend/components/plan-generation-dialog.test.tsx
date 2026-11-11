// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PlanGenerationDialog } from "./plan-generation-dialog";

afterEach(cleanup);

it("explains that the current plan stays unchanged while a new plan is built", () => {
  render(<PlanGenerationDialog open />);

  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.getByText("Building your plan")).toBeTruthy();
  expect(screen.getByText(/current plan stays unchanged/i)).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("This can take a moment.");
  fireEvent.keyDown(document, { key: "Escape" });
});

it("stays closed when generation is not active", () => {
  render(<PlanGenerationDialog open={false} />);

  expect(screen.queryByRole("dialog")).toBeNull();
});
