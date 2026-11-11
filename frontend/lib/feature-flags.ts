/**
 * Email reminder preferences need API support that the current backend does
 * not have. They stay off unless this is set, so the UI does not call
 * missing routes.
 *
 * Enable with `NEXT_PUBLIC_EXTENDED_STUDY_PLANNING=1`.
 */
export function extendedStudyPlanningEnabled(): boolean {
  return process.env.NEXT_PUBLIC_EXTENDED_STUDY_PLANNING === "1";
}
