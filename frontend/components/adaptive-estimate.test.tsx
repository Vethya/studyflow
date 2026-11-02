// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { acknowledgeAdjustmentMock } = vi.hoisted(() => ({
  acknowledgeAdjustmentMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ scheduling: { acknowledgeAdjustment: acknowledgeAdjustmentMock } }));

import {
  AdaptiveEstimateNote,
  LargeAdjustmentDialog,
  describeEstimateBasis,
  describeEstimateRange,
} from "./adaptive-estimate";

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

const basis = {
  scope: "category" as const,
  sizeBucket: "medium" as const,
  completedRecords: 6,
  provisionalRecords: 2,
  categoryRecords: 5,
  sizeRecords: 3,
};

it("shows the likely range and the history it is based on", () => {
  render(
    <AdaptiveEstimateNote
      estimate={{ ...estimate, category: "Reading", adaptiveEstimate: 86, range: { low: 75, high: 110 }, sampleSize: 8, basis }}
    />,
  );
  expect(screen.getByText("About 1h 26m · likely 1h 15m–1h 50m")).toBeTruthy();
  expect(screen.getByText(/Mostly based on your earlier Reading tasks, including some still in progress\./)).toBeTruthy();
});

it("shows only the range or only the basis when the other is missing", () => {
  const { rerender } = render(<AdaptiveEstimateNote estimate={{ ...estimate, range: { low: 100, high: 140 }, basis: null }} />);
  expect(screen.getByText("About 2h · likely 1h 40m–2h 20m")).toBeTruthy();
  expect(screen.queryByText(/based on your earlier Assignment tasks/)).toBeNull();
  rerender(<AdaptiveEstimateNote estimate={{ ...estimate, range: null, basis }} />);
  expect(screen.queryByText(/likely/)).toBeNull();
  expect(screen.getByText(/Mostly based on your earlier Assignment tasks/)).toBeTruthy();
});

it("describes ranges and history sources in plain words", () => {
  expect(describeEstimateRange(estimate)).toBeNull();
  expect(describeEstimateRange({ ...estimate, range: { low: 120, high: 120 } })).toBeNull();
  expect(describeEstimateBasis(estimate)).toBeNull();
  expect(describeEstimateBasis({ ...estimate, sampleSize: 1, basis: { ...basis, scope: "size", provisionalRecords: 0 } })).toBe(
    "Mostly based on your earlier tasks of a similar size.",
  );
  expect(describeEstimateBasis({ ...estimate, sampleSize: null, basis: { ...basis, scope: "overall" } })).toBe(
    "Based on all your earlier tasks, including some still in progress.",
  );
});

it("renders faster, category-agnostic, and read-only estimate variants", () => {
  render(<AdaptiveEstimateNote estimate={{ ...estimate, adaptiveEstimate: 30, plannedDuration: 60, factor: 0.5, isCategorySpecific: false }} />);
  expect(screen.getByText(/finish these faster/)).toBeTruthy();
  expect(screen.getByText(/earlier finished tasks/)).toBeTruthy();
  expect(screen.getAllByText(/Your estimate/).length).toBeGreaterThan(0);
});

it("chooses the original value in a large-adjustment dialog and handles no estimate", async () => {
  const onOpenChange = vi.fn();
  const onDecided = vi.fn();
  const { rerender } = render(<LargeAdjustmentDialog estimate={null} open onOpenChange={onOpenChange} onDecided={onDecided} />);
  expect(screen.queryByRole("dialog")).toBeNull();
  rerender(<LargeAdjustmentDialog estimate={{ ...estimate, adaptiveEstimate: 30, plannedDuration: 60, factor: 0.5, isCategorySpecific: false }} open onOpenChange={onOpenChange} onDecided={onDecided} />);
  fireEvent.click(screen.getByRole("button", { name: "Keep 1h" }));
  await waitFor(() => expect(onDecided).toHaveBeenCalledWith("original"));
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
