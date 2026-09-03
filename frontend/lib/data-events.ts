/** Broadcasts data changes made by WebMCP so mounted screens can refresh. */
export const STUDYFLOW_DATA_CHANGED_EVENT = "studyflow:data-changed";

export function notifyStudyFlowDataChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(STUDYFLOW_DATA_CHANGED_EVENT));
  }
}
