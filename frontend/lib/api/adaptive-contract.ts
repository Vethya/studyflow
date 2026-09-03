import type { AdaptiveEstimate } from "@/types/progress";
import type { Category } from "@/types/task";
import type { WireAdaptiveEstimatePreview, WireTaskCategory } from "./wire";

const CATEGORY_FROM_WIRE: Record<WireTaskCategory, Category> = {
  assignment: "Assignment",
  reading: "Reading",
  exam_preparation: "Exam Preparation",
  project: "Project",
  research_writing: "Research/Writing",
  other: "Other",
};

/**
 * Converts a student-safe adaptive preview into the explanation shape the UI
 * needs. An unavailable or incomplete preview deliberately stays hidden.
 */
export function toAdaptiveEstimate(
  wire: WireAdaptiveEstimatePreview,
): AdaptiveEstimate | null {
  if (
    !wire.available ||
    wire.adaptive_minutes === null ||
    wire.correction_factor === null ||
    wire.history_scope === null ||
    wire.history_count === null
  ) {
    return null;
  }

  return {
    category: CATEGORY_FROM_WIRE[wire.category],
    originalEstimate: wire.original_minutes,
    adaptiveEstimate: wire.adaptive_minutes,
    plannedDuration: wire.planned_minutes,
    plannedSource: wire.planned_source === "adaptive" ? "Adaptive" : "Original",
    factor: wire.correction_factor,
    basedOnTasks: wire.history_count,
    isCategorySpecific: wire.history_scope === "category",
    needsAcknowledgment: wire.acknowledgment_required,
  };
}
