// @vitest-environment jsdom
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PageHeader } from "./page-kit";

afterEach(cleanup);

describe("PageHeader responsive actions", () => {
  it("contains action buttons on mobile and restores desktop sizing", () => {
    const { container } = render(
      <PageHeader
        title="Availability"
        actions={
          <>
            <button type="button">Re-plan my time</button>
            <button type="button">Add exception</button>
            <button type="button">Add window</button>
          </>
        }
      />,
    );

    const actions = container.querySelector('[data-slot="page-header-actions"]');
    expect(actions).not.toBeNull();
    expect(actions?.className ?? "").toContain("w-full");
    expect(actions?.className ?? "").toContain("min-w-0");
    expect(actions?.className ?? "").toContain("max-w-full");
    expect(actions?.className ?? "").toContain("sm:w-auto");
    expect(actions?.className ?? "").toContain("sm:shrink-0");
  });
});
