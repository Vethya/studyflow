// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WeekGrid } from "./week-grid";

afterEach(cleanup);

it("covers selectable and static blocks, badges, hover state, and the current-time rule", () => {
  const onSelect = vi.fn();
  const onHighlight = vi.fn();
  render(
    <WeekGrid
      columns={[{ key: "mon", label: "Mon", sublabel: "29", isToday: true }]}
      hourStart={8}
      hourEnd={12}
      now={{ columnKey: "mon", minutes: 600 }}
      onHighlight={onHighlight}
      blocks={[
        {
          id: "selectable",
          columnKey: "mon",
          start: 540,
          end: 660,
          variant: "session",
          title: "Selectable session",
          label: "Selectable session",
          meta: "09:00–11:00",
          badge: "Proposed",
          tone: "proposed",
          attention: true,
          onSelect,
        },
        {
          id: "static-session",
          columnKey: "mon",
          start: 660,
          end: 690,
          variant: "session",
          title: "Static session",
          label: "Static session",
          meta: "11:00",
          settled: true,
          badge: "Completed",
          tone: "completed",
        },
        { id: "free", columnKey: "mon", start: 690, end: 720, variant: "available", title: "Free" },
        { id: "blocked", columnKey: "mon", start: 720, end: 750, variant: "blocked", title: "Blocked" },
      ]}
    />,
  );

  const selectable = screen.getByRole("button", { name: "Selectable session" });
  fireEvent.mouseEnter(selectable);
  fireEvent.mouseLeave(selectable);
  fireEvent.focus(selectable);
  fireEvent.blur(selectable);
  fireEvent.click(selectable);
  expect(onSelect).toHaveBeenCalledOnce();

  const staticSession = screen.getByTitle("Static session");
  fireEvent.mouseEnter(staticSession);
  fireEvent.mouseLeave(staticSession);
  expect(screen.getByText("Proposed")).toBeTruthy();
  expect(screen.getByText("Completed")).toBeTruthy();
  expect(onHighlight).toHaveBeenCalled();
});
