// @vitest-environment jsdom
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mutate = vi.hoisted(() => vi.fn((filter?: (key: unknown) => boolean) => {
  if (typeof filter === "function") {
    filter(["studyflow/tasks"]);
    filter("studyflow/tasks");
    filter(42);
  }
}));

vi.mock("swr", () => ({
  SWRConfig: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSWRConfig: () => ({ mutate }),
}));

import { StudyFlowSWRProvider } from "./swr-provider";

afterEach(() => cleanup());

it("filters cache keys for every mutation event shape", () => {
  render(<StudyFlowSWRProvider><span>content</span></StudyFlowSWRProvider>);
  for (const path of [
    "/tasks/1",
    "/availability/windows",
    "/account/profile",
    "/account/password",
    "/account/preferences",
    "/account/identities",
    "/account/deletion/status",
    "/adaptive-estimates/Reading",
    "/schedule-proposals",
    "/schedule-proposals/1/reject",
    "/schedule-proposals/1/accept",
    "/study-sessions/1/outcome",
    "/unknown",
  ]) {
    window.dispatchEvent(new CustomEvent("studyflow:data-changed", { detail: { path } }));
  }
  window.dispatchEvent(new CustomEvent("studyflow:data-changed"));
  expect(mutate).toHaveBeenCalled();
});
