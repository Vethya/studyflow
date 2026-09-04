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
 * Keeps a student's original estimate separate from the source chosen for
 * planning. The backend resolves the matching adaptive snapshot; the form
 * must never replace the student's entered minutes with that suggestion.
 */
export function resolveEstimateSelection(
  originalEstimate: number,
  estimate: AdaptiveEstimate | null,
  choice: "original" | "adaptive",
): { originalEstimate: number; plannedSource: "Original" | "Adaptive" } {
  return {
    originalEstimate,
    plannedSource: choice === "adaptive" && estimate ? "Adaptive" : "Original",
  };
}

/**
 * A large first-time adjustment needs acknowledgment only when the student
 * elects to use Adaptive. Original remains an immediately available choice.
 */
export function resolveEstimateChoiceAction(
  originalEstimate: number,
  estimate: AdaptiveEstimate | null,
  choice: "original" | "adaptive",
):
  | { type: "acknowledge" }
  | {
      type: "select";
      selection: { originalEstimate: number; plannedSource: "Original" | "Adaptive" };
    } {
  if (choice === "adaptive" && estimate?.needsAcknowledgment) {
    return { type: "acknowledge" };
  }

  return {
    type: "select",
    selection: resolveEstimateSelection(originalEstimate, estimate, choice),
  };
}

/**
 * Resolves a preview without rewriting a source the student already chose for
 * an existing task. Only a fresh or deliberately changed estimate input may
 * accept the preview's qualified, acknowledged default.
 */
export function resolvePreviewSelection(
  originalEstimate: number,
  estimate: AdaptiveEstimate | null,
  currentPlannedSource: "Original" | "Adaptive",
  applyPreviewDefault: boolean,
): { originalEstimate: number; plannedSource: "Original" | "Adaptive" } {
  if (!applyPreviewDefault) {
    return { originalEstimate, plannedSource: currentPlannedSource };
  }

  return resolveEstimateSelection(
    originalEstimate,
    estimate,
    estimate && !estimate.needsAcknowledgment ? "adaptive" : "original",
  );
}

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
