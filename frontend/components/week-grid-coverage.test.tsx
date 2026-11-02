// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WeekGrid } from "./week-grid";

afterEach(cleanup);

it("keeps day headers but replaces an empty timetable with setup guidance", () => {
  render(<WeekGrid columns={[{ key: "mon", label: "Mon", sublabel: "29" }]} blocks={[]} hourStart={8} hourEnd={22} emptyContent={<p>Build your first plan</p>} />);
  expect(screen.getByText("Mon")).toBeTruthy();
  expect(screen.getByText("Build your first plan")).toBeTruthy();
  expect(screen.queryByText("08:00")).toBeNull();
});

it("sizes a fitted grid's hours to the room left below it, within readable bounds", () => {
  const columns = [{ key: "mon", label: "Mon" }];
  const blocks = [{ id: "s", columnKey: "mon", start: 9 * 60, end: 10 * 60, variant: "session" as const, title: "Session" }];
  const main = document.createElement("main");
  document.body.appendChild(main);
  let clientHeight = 900;
  Object.defineProperty(main, "clientHeight", { configurable: true, get: () => clientHeight });
  main.scrollTop = 40;
  main.getBoundingClientRect = () => ({ top: 56 }) as DOMRect;
  const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ top: 316 } as DOMRect);

  const view = render(<WeekGrid fit columns={columns} blocks={blocks} hourStart={8} hourEnd={18} />, { container: main });
  const session = () => screen.getByTitle("Session");
  // (900 visible − 300 above the grid − 96 legend and padding − 24 insets) / 10 hours.
  expect(session().style.height).toBe("48px");
  expect(session().style.top).toBe("48px");
  expect(screen.getByRole("region", { name: "Week view" }).className).toContain("overflow-y-hidden");

  // Never taller than a normal hour…
  clientHeight = 2000;
  act(() => window.dispatchEvent(new Event("resize")));
  expect(session().style.height).toBe("56px");
  // …and never squeezed below a readable one: the page scrolls instead.
  clientHeight = 300;
  act(() => window.dispatchEvent(new Event("resize")));
  expect(session().style.height).toBe("44px");

  view.rerender(<WeekGrid fit columns={columns} blocks={[]} hourStart={8} hourEnd={18} emptyContent={<p>Empty</p>} />);
  expect(screen.getByText("Empty")).toBeTruthy();

  rect.mockRestore();
  main.remove();
});

it("keeps normal hours when a fitted grid is outside a page scroll area", () => {
  render(<WeekGrid fit columns={[{ key: "mon", label: "Mon" }]} blocks={[{ id: "s", columnKey: "mon", start: 9 * 60, end: 9 * 60 + 30, variant: "session", title: "Short", label: "Short" }]} hourStart={8} hourEnd={18} />);
  expect(screen.getByTitle("Short").style.top).toBe("56px");
  // A half-hour session centres its single line.
  expect(screen.getByText("Short").parentElement!.parentElement!.className).toContain("items-center");
});

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
