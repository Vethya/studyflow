// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { acknowledgeAdjustmentMock } = vi.hoisted(() => ({
  acknowledgeAdjustmentMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ scheduling: { acknowledgeAdjustment: acknowledgeAdjustmentMock } }));

import { AdaptiveEstimateNote, LargeAdjustmentDialog } from "./adaptive-estimate";

afterEach(() => {
  cleanup();
  acknowledgeAdjustmentMock.mockReset();
});

const estimate = {
  category: "Assignment" as const,
  originalEstimate: 60,
  adaptiveEstimate: 120,
  plannedDuration: 120,
  plannedSource: "Adaptive" as const,
  factor: 2,
  basedOnTasks: 6,
  isCategorySpecific: true,
  needsAcknowledgment: true,
};

it("explains an adaptive estimate and lets the student choose the source", () => {
  const onChoose = vi.fn();
  render(<AdaptiveEstimateNote estimate={estimate} onChoose={onChoose} />);

  expect(screen.getByText(/usually need longer/)).toBeTruthy();
  expect(screen.getAllByText("2h").length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: /Your estimate · 1h/ })).toBeTruthy();
  expect(screen.queryByText(/sample|accuracy|MAE/i)).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: /Your estimate/ }));
  expect(onChoose).toHaveBeenCalledWith("original");
});

it("acknowledges a large adjustment before applying the selected estimate", async () => {
  acknowledgeAdjustmentMock.mockResolvedValue(undefined);
  const onOpenChange = vi.fn();
  const onDecided = vi.fn();
  render(
    <LargeAdjustmentDialog
      estimate={estimate}
      open
      onOpenChange={onOpenChange}
      onDecided={onDecided}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Use 2h" }));

  await waitFor(() => expect(acknowledgeAdjustmentMock).toHaveBeenCalledWith("Assignment"));
  expect(onDecided).toHaveBeenCalledWith("adaptive");
  expect(onOpenChange).toHaveBeenCalledWith(false);
});
