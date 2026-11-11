import { expect, it } from "vitest";
import { describeLastCheck } from "./google-import-button";

it("phrases the last Google check in days", () => {
  expect(describeLastCheck(0)).toBe("today");
  expect(describeLastCheck(1)).toBe("yesterday");
  expect(describeLastCheck(6)).toBe("6 days ago");
});
