// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-day-picker", () => ({
  getDefaultClassNames: () => ({
    root: "root", months: "months", month: "month", nav: "nav", button_previous: "prev",
    button_next: "next", month_caption: "caption", dropdowns: "dropdowns", dropdown_root: "dropdown-root",
    dropdown: "dropdown", caption_label: "caption-label", month_grid: "grid", weekdays: "weekdays",
    weekday: "weekday", week: "week", week_number_header: "week-number-header", week_number: "week-number",
    day: "day", range_start: "range-start", range_middle: "range-middle", range_end: "range-end",
    today: "today", outside: "outside", disabled: "disabled", hidden: "hidden",
  }),
  DayPicker: (props: any) => {
    const Root = props.components.Root;
    const Chevron = props.components.Chevron;
    const DayButton = props.components.DayButton;
    const WeekNumber = props.components.WeekNumber;
    return <Root><Chevron orientation="left" /><Chevron orientation="right" /><Chevron orientation="down" /><DayButton day={{ date: new Date("2026-09-14T00:00:00Z") }} modifiers={{ focused: false, selected: false, range_start: false, range_end: false, range_middle: false }} /><WeekNumber>1</WeekNumber></Root>;
  },
}));

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  Tooltip: () => null,
  Legend: () => null,
}));

import { Calendar, CalendarDayButton } from "./calendar";
import { ChartContainer, ChartLegendContent, ChartStyle, ChartTooltipContent } from "./chart";

afterEach(cleanup);

describe("calendar and chart edge branches", () => {
  it("renders custom calendar slots and focuses a day button", () => {
    const { rerender } = render(<Calendar captionLayout="label" />);
    expect(document.querySelector("[data-slot='calendar']")).toBeTruthy();
    rerender(<Calendar captionLayout="dropdown" showWeekNumber />);
    expect(screen.getByText("1")).toBeTruthy();
    render(<CalendarDayButton day={{ date: new Date("2026-09-14T00:00:00Z") } as any} modifiers={{ focused: true, selected: true, range_start: true, range_end: false, range_middle: false } as any} />);
    render(<CalendarDayButton day={{ date: new Date("2026-09-15T00:00:00Z") } as any} modifiers={{ focused: false, selected: true, range_start: false, range_end: false, range_middle: false } as any} />);
    expect(document.querySelector("button[data-day='9/14/2026']")).toBeTruthy();
  });

  it("covers chart empty, formatted, icon, and legend payloads", () => {
    const Icon = () => <span data-testid="icon" />;
    render(<div>
      <ChartStyle id="empty" config={{}} />
      <ChartStyle id="fallback" config={{ noColor: { label: "No color", theme: { light: "" } } }} />
      <ChartContainer config={{ value: { label: "Value", color: "red" }, icon: { label: "Icon", color: "blue", icon: Icon } }}>
        <ChartTooltipContent active={false} payload={[]} />
        <ChartTooltipContent active={false} payload={[null as any]} />
        <ChartTooltipContent active payload={[{ dataKey: "value", name: "Value", value: 10, color: "red", payload: { value: "value" } }]} indicator="line" label="value" labelFormatter={(value) => `Label ${value}`} />
        <ChartTooltipContent active payload={[{ value: 13, payload: {} }]} label="missing" />
        <ChartTooltipContent active payload={[{ value: 14, payload: {} }]} />
        <ChartTooltipContent active payload={[{ dataKey: "unknown", name: "Unknown", value: 11 }]} />
        <ChartTooltipContent active payload={[{ dataKey: "value", value: "icon", name: "Value", payload: { value: "value" } }]} />
        <ChartTooltipContent active payload={[{ dataKey: "icon", name: "Icon", value: "text", payload: { icon: "icon" } }, { dataKey: "none", type: "none", value: 0 }]} hideIndicator />
        <ChartTooltipContent active payload={[{ dataKey: "icon", value: 12, payload: { icon: "icon" } }]} indicator="dashed" nameKey="icon" />
        <ChartTooltipContent active payload={[{ dataKey: "value", name: "Value", value: 12 }]} formatter={(value) => <span>Formatted {String(value)}</span>} />
        <ChartTooltipContent active payload={[{ dataKey: "value", name: "Value", value: null }]} hideLabel hideIndicator />
        <ChartLegendContent />
        <ChartLegendContent verticalAlign="top" hideIcon payload={[{ dataKey: "value", color: "red" }, { dataKey: "icon", color: "blue" }]} />
        <ChartLegendContent payload={[{ dataKey: "icon", color: "blue" }]} />
        <ChartLegendContent payload={[{ dataKey: "alias", color: "green", payload: { alias: "value" } }]} />
        <ChartLegendContent payload={[{ value: "fallback", color: "purple" }]} />
      </ChartContainer>
    </div>);
    expect(screen.getByText("Label Value")).toBeTruthy();
    expect(screen.getAllByText("Value").length).toBeGreaterThan(0);
  });

  it("rejects chart content rendered without its provider", () => {
    expect(() => render(<ChartTooltipContent active payload={[{ dataKey: "value", value: 1 }]} />)).toThrow("useChart must be used");
  });
});
