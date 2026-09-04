import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiJson, apiVoid } from "./client";
import {
  resolveEstimateChoiceAction,
  resolveEstimateSelection,
  resolvePreviewSelection,
  toAdaptiveEstimate,
} from "./adaptive-contract";
import { toAcademicTask } from "./mappers";
import { acknowledgeAdjustment, getAdaptiveEstimate } from "./scheduling";
import { createTask } from "./tasks";

vi.mock("./client", () => ({
  apiJson: vi.fn(),
  apiVoid: vi.fn(),
  buildQuery: (params: Record<string, string | number | boolean | null | undefined>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined && value !== "") search.set(key, String(value));
    }
    const encoded = search.toString();
    return encoded ? `?${encoded}` : "";
  },
}));

const preview = {
  category: "assignment" as const,
  original_minutes: 60,
  adaptive_minutes: 90,
  planned_minutes: 90,
  correction_factor: "1.5",
  history_scope: "category" as const,
  history_count: 6,
  available: true,
  planned_source: "adaptive" as const,
  acknowledgment_required: true,
};

const taskResponse = {
  id: "task-1",
  title: "Calculus worksheet",
  category: "assignment" as const,
  priority: "high" as const,
  course: "Calculus",
  notes: null,
  deadline_at: "2026-09-12T09:00:00Z",
  original_estimate_minutes: 60,
  adaptive_estimate_minutes: 90,
  planned_source: "adaptive" as const,
  planned_duration_minutes: 90,
  created_at: "2026-09-04T09:00:00Z",
  updated_at: "2026-09-04T09:00:00Z",
  status: "not_started" as const,
};

describe("adaptive API contract", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hides an unavailable preview instead of inventing an estimate", () => {
    expect(
      toAdaptiveEstimate({
        ...preview,
        adaptive_minutes: null,
        correction_factor: null,
        history_scope: null,
        history_count: null,
        available: false,
        planned_source: "original",
      }),
    ).toBeNull();
  });

  it("maps a qualified category preview and its acknowledgement requirement", () => {
    expect(toAdaptiveEstimate(preview)).toEqual({
      category: "Assignment",
      originalEstimate: 60,
      adaptiveEstimate: 90,
      plannedDuration: 90,
      plannedSource: "Adaptive",
      factor: 1.5,
      basedOnTasks: 6,
      isCategorySpecific: true,
      needsAcknowledgment: true,
    });
  });

  it("marks overall history as non-category-specific", () => {
    expect(toAdaptiveEstimate({ ...preview, history_scope: "overall" })?.isCategorySpecific).toBe(
      false,
    );
  });

  it("requests a preview with the wire category and original minutes", async () => {
    vi.mocked(apiJson).mockResolvedValue(preview);

    await expect(getAdaptiveEstimate("Assignment", 60)).resolves.toMatchObject({
      adaptiveEstimate: 90,
    });

    expect(apiJson).toHaveBeenCalledWith(
      "/adaptive-estimates/preview?category=assignment&original_minutes=60",
      { signal: undefined },
    );
  });

  it("converts the API decimal string before the dialog formats its factor", async () => {
    vi.mocked(apiJson).mockResolvedValue({ ...preview, correction_factor: "2.5000" });

    const estimate = await getAdaptiveEstimate("Assignment", 60);

    expect(estimate?.factor).toBe(2.5);
    expect(estimate?.factor.toFixed(1)).toBe("2.5");
  });

  it.each(["", " ", "invalid", "NaN", "Infinity", "0", "-1"])(
    "hides a malformed or nonpositive correction factor: %s",
    (correction_factor) => {
      expect(toAdaptiveEstimate({ ...preview, correction_factor })).toBeNull();
    },
  );

  it("posts the selected category acknowledgement", async () => {
    await acknowledgeAdjustment("Research/Writing");

    expect(apiVoid).toHaveBeenCalledWith("/adaptive-estimates/acknowledgments", {
      method: "POST",
      body: { category: "research_writing" },
      signal: undefined,
    });
  });

  it("maps adaptive snapshots and the selected source returned for a task", () => {
    expect(toAcademicTask(taskResponse)).toMatchObject({
      adaptiveEstimate: 90,
      plannedSource: "Adaptive",
      plannedDuration: 90,
    });
  });

  it("keeps the entered original minutes when Adaptive is selected", () => {
    expect(resolveEstimateSelection(60, toAdaptiveEstimate(preview), "adaptive")).toEqual({
      originalEstimate: 60,
      plannedSource: "Adaptive",
    });
  });

  it("keeps a persisted Original source when a qualified preview would default to Adaptive", () => {
    expect(
      resolvePreviewSelection(
        60,
        toAdaptiveEstimate({ ...preview, acknowledgment_required: false }),
        "Original",
        false,
      ),
    ).toEqual({
      originalEstimate: 60,
      plannedSource: "Original",
    });
  });

  it("keeps a persisted Adaptive source when a preview would default to Original", () => {
    expect(resolvePreviewSelection(60, toAdaptiveEstimate(preview), "Adaptive", false)).toEqual({
      originalEstimate: 60,
      plannedSource: "Adaptive",
    });
  });

  it("routes a first large suggested choice through acknowledgment while Original stays selectable", () => {
    const largeAdjustment = toAdaptiveEstimate(preview);

    expect(resolveEstimateChoiceAction(60, largeAdjustment, "original")).toEqual({
      type: "select",
      selection: { originalEstimate: 60, plannedSource: "Original" },
    });
    expect(resolveEstimateChoiceAction(60, largeAdjustment, "adaptive")).toEqual({
      type: "acknowledge",
    });
  });

  it("preserves original minutes while sending the selected adaptive source", async () => {
    vi.mocked(apiJson).mockResolvedValue(taskResponse);

    await createTask({
      title: "Calculus worksheet",
      category: "Assignment",
      priority: "High",
      deadline: "2026-09-12T09:00:00Z",
      originalEstimate: 60,
      plannedSource: "Adaptive",
      course: "Calculus",
    });

    expect(apiJson).toHaveBeenCalledWith("/tasks", {
      method: "POST",
      body: {
        title: "Calculus worksheet",
        category: "assignment",
        priority: "high",
        course: "Calculus",
        notes: null,
        deadline_at: "2026-09-12T09:00:00Z",
        original_estimate_minutes: 60,
        planned_source: "adaptive",
      },
      signal: undefined,
    });
  });

  it("omits planned source when a caller has not made a selection", async () => {
    vi.mocked(apiJson).mockResolvedValue(taskResponse);

    await createTask({
      title: "Calculus worksheet",
      category: "Assignment",
      priority: "High",
      deadline: "2026-09-12T09:00:00Z",
      originalEstimate: 60,
    });

    expect(apiJson).toHaveBeenCalledWith("/tasks", {
      method: "POST",
      body: {
        title: "Calculus worksheet",
        category: "assignment",
        priority: "high",
        course: null,
        notes: null,
        deadline_at: "2026-09-12T09:00:00Z",
        original_estimate_minutes: 60,
      },
      signal: undefined,
    });
  });
});
