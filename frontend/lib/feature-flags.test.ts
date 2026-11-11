import { afterEach, expect, it, vi } from "vitest";
import { extendedStudyPlanningEnabled } from "./feature-flags";

afterEach(() => {
  vi.unstubAllEnvs();
});

it("keeps extended planning off unless the env var is 1", () => {
  vi.stubEnv("NEXT_PUBLIC_EXTENDED_STUDY_PLANNING", "");
  expect(extendedStudyPlanningEnabled()).toBe(false);
  vi.stubEnv("NEXT_PUBLIC_EXTENDED_STUDY_PLANNING", "true");
  expect(extendedStudyPlanningEnabled()).toBe(false);
  vi.stubEnv("NEXT_PUBLIC_EXTENDED_STUDY_PLANNING", "1");
  expect(extendedStudyPlanningEnabled()).toBe(true);
});
