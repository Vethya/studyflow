// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookOpen } from "@/components/icons";
import { DayTimeline } from "./day-timeline";
import { WeekLoad, WeekLoadLegend, type DayLoad } from "./week-load";
import { StudyAgenda } from "./study-agenda";
import { GridLegend, WeekGrid, type GridBlock } from "./week-grid";
import {
  CategoryTag,
  EmptyState,
  Figure,
  FigureRow,
  PageHeader,
  PageShell,
  SectionCard,
  SectionHeader,
  StatCard,
} from "./page-kit";
import {
  DateLeaf,
  DueChip,
  EffortBar,
  SectionLabel,
  SettingRow,
  StatusDot,
  StepFlow,
  TaskLine,
  VerdictBadge,
} from "./study-kit";
import type { StudySession } from "@/types/session";
import type { AcademicTask } from "@/types/task";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));
vi.mock("@/hooks/use-account-timezone", () => ({ useAccountTimezone: () => "UTC" }));
vi.mock("@/hooks/use-now", () => ({ useNow: () => new Date("2026-09-29T10:00:00Z") }));

afterEach(cleanup);

const NOW = new Date("2026-09-29T10:00:00Z");

function session(id: string, start: string, end: string, extra: Partial<StudySession> = {}): StudySession {
  return {
    id,
    taskId: "task-1",
    taskTitle: `Task ${id}`,
    category: "Reading",
    startTime: start,
    endTime: end,
    plannedDuration: 60,
    isAwaitingOutcome: false,
    ...extra,
  };
}

const task: AcademicTask = {
  id: "task-1",
  title: "Read algorithms",
  category: "Reading",
  deadline: "2026-10-02T12:00:00Z",
  priority: "High",
  originalEstimate: 120,
  plannedSource: "Original",
  plannedDuration: 120,
  actualDuration: 30,
  remainingDuration: 90,
  course: "Algorithms",
  status: "In Progress",
  sessionsCompleted: 1,
  sessionsUpcoming: 1,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-20T00:00:00Z",
};

describe("DayTimeline", () => {
  it("shows skeletons while loading", () => {
    const { container } = render(
      <DayTimeline sessions={[]} now={NOW} timeZone="UTC" isLoading hasPlan onRecord={vi.fn()} />,
    );
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBe(3);
  });

  it("picks the empty state from whether a plan exists", () => {
    const other = [session("other-day", "2026-09-30T09:00:00Z", "2026-09-30T10:00:00Z")];
    render(<DayTimeline sessions={other} now={NOW} timeZone="UTC" hasPlan onRecord={vi.fn()} />);
    expect(screen.getByText(/Nothing is booked for today/)).toBeTruthy();
    expect(screen.getByText("Open the calendar").closest("a")?.getAttribute("href")).toBe("/calendar");
    cleanup();
    render(<DayTimeline sessions={[]} now={NOW} timeZone="UTC" hasPlan={false} onRecord={vi.fn()} />);
    expect(screen.getByText(/No sessions yet/)).toBeTruthy();
    expect(screen.getByText(/Plan my time/).closest("a")?.getAttribute("href")).toBe("/calendar");
  });

  it("labels every phase and records a waiting session", () => {
    const onRecord = vi.fn();
    const waiting = session("waiting", "2026-09-29T09:00:00Z", "2026-09-29T09:30:00Z", { isAwaitingOutcome: true });
    const sessions = [
      session("later", "2026-09-29T13:00:00Z", "2026-09-29T14:00:00Z"),
      session("done", "2026-09-29T07:00:00Z", "2026-09-29T08:00:00Z", { outcome: "Completed" }),
      session("delayed", "2026-09-29T08:00:00Z", "2026-09-29T09:00:00Z", { outcome: "Delayed" }),
      waiting,
      session("now", "2026-09-29T09:45:00Z", "2026-09-29T10:30:00Z"),
      session("missed-future", "2026-09-29T10:45:00Z", "2026-09-29T11:00:00Z", { outcome: "Missed" }),
      session("next", "2026-09-29T11:00:00Z", "2026-09-29T12:00:00Z"),
      session("tomorrow", "2026-09-30T11:00:00Z", "2026-09-30T12:00:00Z"),
    ];
    render(<DayTimeline sessions={sessions} now={NOW} timeZone="UTC" hasPlan onRecord={onRecord} />);

    const list = screen.getByRole("list", { name: "Today’s study sessions" });
    expect(list.querySelectorAll("li").length).toBe(7);
    expect(screen.getByText("Done")).toBeTruthy();
    expect(screen.getByText("Partly done")).toBeTruthy();
    expect(screen.getByText("Missed")).toBeTruthy();
    expect(screen.getByText("How did it go?")).toBeTruthy();
    expect(screen.getByText(/In progress · 30m left|In progress/)).toBeTruthy();
    expect(screen.getByText("Up next")).toBeTruthy();
    expect(screen.queryByText("Task tomorrow")).toBeNull();
    expect(screen.queryByText("Now")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Record what happened in Task waiting" }));
    expect(onRecord).toHaveBeenCalledWith(waiting);
  });

  it("draws the now line before the first upcoming session", () => {
    render(
      <DayTimeline
        sessions={[
          session("future", "2026-09-29T12:00:00Z", "2026-09-29T13:00:00Z"),
          session("past", "2026-09-29T07:00:00Z", "2026-09-29T08:00:00Z", { outcome: "Completed" }),
        ]}
        now={NOW}
        timeZone="UTC"
        hasPlan
        onRecord={vi.fn()}
      />,
    );
    const items = Array.from(screen.getByRole("list").querySelectorAll(":scope > li"));
    expect(items[1].getAttribute("aria-label")).toMatch(/^Now, /);
    expect(screen.getByText("Up next")).toBeTruthy();
  });

  it("draws the now line at the end once every session has started", () => {
    render(
      <DayTimeline
        sessions={[session("past", "2026-09-29T07:00:00Z", "2026-09-29T08:00:00Z")]}
        now={NOW}
        timeZone="UTC"
        hasPlan
        onRecord={vi.fn()}
      />,
    );
    const items = Array.from(screen.getByRole("list").querySelectorAll(":scope > li"));
    expect(items).toHaveLength(2);
    expect(items[1].getAttribute("aria-label")).toMatch(/^Now, /);
    expect(screen.queryByText("Up next")).toBeNull();
  });
});

describe("WeekLoad", () => {
  const day = (key: string, extra: Partial<DayLoad> = {}): DayLoad => ({
    key,
    label: key,
    longLabel: `Long ${key}`,
    dayNumber: "1",
    free: 120,
    planned: 60,
    deadlines: 0,
    isToday: false,
    ...extra,
  });

  it("summarises each day and reports the selection", () => {
    const onSelect = vi.fn();
    render(
      <WeekLoad
        className="custom"
        selectedKey="mon"
        onSelect={onSelect}
        days={[
          day("mon", { isToday: true, deadlines: 1 }),
          day("tue", { deadlines: 2, planned: 0 }),
          day("wed", { free: 0, planned: 0 }),
          day("thu", { free: 0, planned: 90 }),
        ]}
      />,
    );
    const group = screen.getByRole("group", { name: "Your week at a glance" });
    expect(group.getAttribute("aria-busy")).toBeNull();
    expect(group.className).toContain("custom");

    const mon = screen.getByRole("button", { name: "Long mon (today): 1h planned, 1h still free, 1 deadline" });
    expect(mon.getAttribute("aria-pressed")).toBe("true");
    const tue = screen.getByRole("button", { name: /^Long tue: .* free, 2 deadlines$/ });
    expect(tue.getAttribute("aria-pressed")).toBe("false");
    expect(tue.textContent).toContain("–");
    expect(screen.getByRole("button", { name: "Long wed: No study time" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Long thu: No study time" }).textContent).toContain("1h 30m");

    fireEvent.click(tue);
    expect(onSelect).toHaveBeenCalledWith("tue");
  });

  it("shows a loading state and works without a picker", () => {
    const { container } = render(<WeekLoad loading days={[day("mon"), day("tue", { free: 0, planned: 0 })]} />);
    expect(screen.getByRole("group").getAttribute("aria-busy")).toBe("true");
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBe(2);
    const mon = screen.getByRole("button", { name: /^Long mon:/ });
    expect(mon.getAttribute("aria-pressed")).toBeNull();
    fireEvent.click(mon);
  });

  it("renders the legend", () => {
    render(<WeekLoadLegend className="legend" />);
    expect(screen.getByText("Study planned")).toBeTruthy();
    expect(screen.getByText("Free to study")).toBeTruthy();
    expect(screen.getByText("Deadlines")).toBeTruthy();
  });
});

describe("StudyAgenda", () => {
  it("shows the empty state when nothing is planned", () => {
    render(
      <StudyAgenda
        columns={[{ key: "mon", label: "Mon" }, { key: "tue", label: "Tue" }]}
        blocks={[{ id: "free", columnKey: "mon", start: 540, end: 600, variant: "available" }]}
        deadlines={new Map([["mon", []]])}
        timeZone="UTC"
        emptyAction={<button type="button">Plan</button>}
      />,
    );
    expect(screen.getByText("No sessions planned")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Plan" })).toBeTruthy();
  });

  it("lists deadlines, sessions, free time and quiet days", () => {
    const onSelect = vi.fn();
    render(
      <StudyAgenda
        columns={[
          { key: "mon", label: "Mon", sublabel: "28", month: "Apr", isToday: true },
          { key: "tue", label: "Tue", month: "Apr" },
          { key: "wed", label: "Wed", sublabel: "30", month: "Apr" },
        ]}
        blocks={[
          { id: "late", columnKey: "mon", start: 720, end: 780, variant: "session", title: "Late session", label: "Late", meta: "12:00", durationMinutes: 90, attention: true, onSelect },
          { id: "early", columnKey: "mon", start: 540, end: 600, variant: "session", title: "Early session", label: "Early", meta: "09:00", settled: true, dotClassName: "bg-primary" },
          { id: "free", columnKey: "mon", start: 600, end: 660, variant: "available" },
          { id: "blocked", columnKey: "tue", start: 600, end: 660, variant: "blocked" },
        ]}
        deadlines={new Map([["wed", [task]]])}
        timeZone="UTC"
        emptyAction={null}
      />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual(["Early session", "Late session"]);
    expect(screen.getByText("Record outcome")).toBeTruthy();
    expect(screen.getByText("Recorded")).toBeTruthy();
    expect(screen.getByText("· Today")).toBeTruthy();
    expect(screen.getAllByText("Apr")).toHaveLength(3);
    const region = screen.getByRole("region", { name: "Study agenda" });
    const tiles = [...region.querySelectorAll("section")].map((section) => section.querySelector("[data-flagged]") !== null);
    expect(tiles).toEqual([true, false, true]);
    expect(screen.getByText(/1h free to study/)).toBeTruthy();
    expect(screen.getByText("No sessions or deadlines")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Read algorithms/ }).getAttribute("href")).toBe("/tasks/task-1");
    expect(screen.getByRole("region", { name: "Study agenda" }).querySelector('section[aria-label="Tue "]')).not.toBeNull();
    fireEvent.click(buttons[1]);
    expect(onSelect).toHaveBeenCalled();
  });
});

describe("WeekGrid", () => {
  it("paints every tone and treatment", () => {
    const onSelect = vi.fn();
    const blocks: GridBlock[] = [
      { id: "missed", columnKey: "mon", start: 480, end: 540, variant: "session", title: "Missed session", label: "Missed", meta: "08:00", badge: "Missed", tone: "missed", dotClassName: "bg-primary" },
      { id: "delayed", columnKey: "mon", start: 540, end: 570, variant: "session", title: "Delayed", label: "Delayed", meta: "09:00", badge: "Partly done", tone: "delayed" },
      { id: "default", columnKey: "mon", start: 570, end: 580, variant: "session", title: "Tiny", label: "Tiny" },
      { id: "plain", columnKey: "mon", start: 580, end: 640, variant: "session", title: "Plain", label: "Plain", badge: "Plain badge", tone: "default", onSelect },
      { id: "settled", columnKey: "tue", start: 480, end: 540, variant: "session", title: "Settled", label: "Settled", badge: "Done", settled: true },
      { id: "free", columnKey: "tue", start: 540, end: 600, variant: "available", title: "Free window", onSelect },
      { id: "blocked", columnKey: "tue", start: 600, end: 660, variant: "blocked", title: "Blocked window", onSelect },
      { id: "static-free", columnKey: "tue", start: 660, end: 700, variant: "available", title: "Static free" },
      { id: "sliver", columnKey: "tue", start: 700, end: 702, variant: "blocked", title: "Sliver", label: "Sliver" },
    ];
    render(
      <WeekGrid
        columns={[{ key: "mon", label: "Mon" }, { key: "tue", label: "Tue", sublabel: "30" }]}
        blocks={blocks}
        hourStart={8}
        hourEnd={12}
        highlightedId="free"
        now={{ columnKey: "tue", minutes: 600 }}
        renderLane={(column) => <span>Lane {column.key}</span>}
        emptyContent={<p>Never shown</p>}
        className="grid-class"
        ariaLabel="Custom week"
      />,
    );
    expect(screen.getByRole("region", { name: "Custom week" })).toBeTruthy();
    expect(screen.getByText("Lane mon")).toBeTruthy();
    expect(screen.queryByText("Never shown")).toBeNull();
    expect(screen.getByText("Partly done")).toBeTruthy();
    expect(screen.getByText("Plain badge")).toBeTruthy();
    expect(screen.getByText("Tiny")).toBeTruthy();
    expect(screen.getByTitle("Tiny").style.height).toBe("22px");
    const sessionTime = screen.getAllByText("08:00").find((node) => node.className.includes("text-foreground"));
    expect(sessionTime?.className).toContain("text-foreground");
    expect(sessionTime?.className).not.toContain("opacity-80");
    expect(screen.queryByText("Sliver")).toBeNull();
    expect(screen.getByTitle("Sliver").style.height).toBe("6px");

    const free = screen.getByRole("button", { name: "Free window" });
    fireEvent.mouseEnter(free);
    fireEvent.mouseLeave(free);
    fireEvent.focus(free);
    fireEvent.blur(free);
    const staticFree = screen.getByTitle("Static free");
    expect(staticFree.getAttribute("aria-label")).toBeNull();
    fireEvent.mouseEnter(staticFree);
    fireEvent.mouseLeave(staticFree);
    fireEvent.click(screen.getByRole("button", { name: "Blocked window" }));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("highlights today, proposals, recorded work and sessions needing attention", () => {
    render(
      <WeekGrid
        columns={[{ key: "mon", label: "Mon", sublabel: "29", isToday: true }]}
        hourStart={8}
        hourEnd={12}
        blocks={[
          { id: "proposed", columnKey: "mon", start: 480, end: 560, variant: "session", title: "Proposed", label: "Long proposal", meta: "08:00", badge: "Proposed", tone: "proposed", attention: true },
          { id: "completed", columnKey: "mon", start: 600, end: 660, variant: "session", title: "Completed", label: "Completed", badge: "Completed badge", tone: "completed" },
        ]}
      />,
    );
    expect(screen.getByText("Long proposal").className).toContain("line-clamp-2");
    expect(screen.getByText("Proposed").className).toContain("text-primary");
    expect(screen.getByText("Completed badge")).toBeTruthy();
  });

  it("replaces the timetable with empty content when there are no blocks", () => {
    render(<WeekGrid columns={[{ key: "mon", label: "Mon" }]} blocks={[]} hourStart={8} hourEnd={10} emptyContent={<p>Nothing yet</p>} />);
    expect(screen.getByText("Nothing yet")).toBeTruthy();
    expect(screen.queryByText("Time")).toBeNull();
  });

  it("keeps one hour row when the range is empty", () => {
    render(<WeekGrid columns={[{ key: "mon", label: "Mon" }]} blocks={[]} hourStart={9} hourEnd={9} />);
    expect(screen.getByText("Time")).toBeTruthy();
  });

  it("renders the legend with and without optional keys", () => {
    render(<GridLegend showDeadline showSession proposalStates={["proposed", "missed", "delayed", "completed"]} />);
    for (const text of ["Proposed", "Missed", "Partly done", "Completed", "Study session", "Deadline"]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
    cleanup();
    render(<GridLegend />);
    expect(screen.queryByText("Proposed")).toBeNull();
    expect(screen.queryByText("Deadline")).toBeNull();
    expect(screen.getByText("Blocked")).toBeTruthy();
  });
});

describe("page kit", () => {
  it("renders shells and headers in every configuration", () => {
    const { container } = render(
      <>
        <PageShell>Wide</PageShell>
        <PageShell width="narrow" className="extra">Narrow</PageShell>
        <PageHeader icon={BookOpen} eyebrow="Today" title="With icon" description="Described" />
        <PageHeader icon={BookOpen} title="Icon only" />
        <PageHeader eyebrow="Eyebrow only" title="Eyebrow" />
        <PageHeader title="Bare" />
        <PageHeader title="With actions" actions={<button type="button">Act</button>} />
      </>,
    );
    expect(screen.getByText("Wide").className).toContain("max-w-7xl");
    expect(screen.getByText("Narrow").className).toContain("max-w-4xl");
    expect(screen.getByText("Described")).toBeTruthy();
    expect(container.querySelectorAll('[data-slot="page-header-actions"]').length).toBe(1);
  });

  it("renders section headers and cards", () => {
    render(
      <>
        <SectionHeader title="Counted" meta={0} tone="deficit" action={{ href: "/tasks", label: "See all" }} />
        <SectionHeader title="Plain" meta="3 items" className="x" />
        <SectionHeader title="Nothing" />
        <SectionCard title="Card" description="Card description" action={<button type="button">Act</button>} footer="Footer" flush>
          Body
        </SectionCard>
        <SectionCard description="Only description">Second</SectionCard>
        <SectionCard action={<span>Only action</span>}>Third</SectionCard>
        <SectionCard>Headless</SectionCard>
      </>,
    );
    expect(screen.getByText("0").className).toContain("text-deficit");
    expect(screen.getByText("3 items").className).not.toContain("text-deficit");
    expect(screen.getByRole("link", { name: "See all →" }).getAttribute("href")).toBe("/tasks");
    expect(screen.getByText("Footer")).toBeTruthy();
    expect(screen.getByText("Only description")).toBeTruthy();
    expect(screen.getByText("Only action")).toBeTruthy();
    expect(screen.getByText("Headless")).toBeTruthy();
  });

  it("renders stat cards with loading, tones, hints and extra content", () => {
    const { container } = render(
      <>
        <StatCard icon={BookOpen} label="Loading stat" value={null} />
        <StatCard label="Short" value="3h" tone="deficit" hint="Over budget" />
        <StatCard label="Spare" value="2h" tone="surplus">
          <span>Extra</span>
        </StatCard>
        <StatCard label="Plain" value={4} />
      </>,
    );
    expect(container.querySelectorAll('[data-slot="stat-card"]').length).toBe(4);
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBe(1);
    expect(screen.getByText("3h").className).toContain("text-deficit");
    expect(screen.getByText("2h").className).toContain("text-surplus");
    expect(screen.getByText("4").className).not.toContain("text-deficit");
    expect(screen.getByText("Over budget")).toBeTruthy();
    expect(screen.getByText("Extra")).toBeTruthy();
  });

  it("renders figures, tags and empty states", () => {
    const { container } = render(
      <>
        <FigureRow>
          <Figure label="Loading" value={null} />
          <Figure label="Over" value="2h" tone="deficit" hint="Too much" />
          <Figure label="Under" value="1h" tone="surplus" />
          <Figure label="Neutral" value="0h" />
        </FigureRow>
        <CategoryTag category="Project" className="tag" />
        <EmptyState icon={BookOpen} title="Empty" action={<button type="button">Fix</button>} className="e">
          Explanation
        </EmptyState>
        <EmptyState title="Bare empty" />
      </>,
    );
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBe(1);
    expect(screen.getByText("2h").className).toContain("text-deficit");
    expect(screen.getByText("1h").className).toContain("text-surplus");
    expect(screen.getByText("Too much")).toBeTruthy();
    expect(container.querySelector('[data-slot="category-tag"]')).not.toBeNull();
    expect(screen.getByText("Explanation")).toBeTruthy();
    expect(screen.getByText("Bare empty")).toBeTruthy();
  });
});

describe("study kit", () => {
  it("renders section labels", () => {
    render(
      <>
        <SectionLabel action={<button type="button">More</button>}>Default</SectionLabel>
        <SectionLabel as="p" className="x">Paragraph</SectionLabel>
      </>,
    );
    expect(screen.getByRole("heading", { name: "Default" }).tagName).toBe("H2");
    expect(screen.getByText("Paragraph").tagName).toBe("P");
  });

  it("describes deadlines by urgency", () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    const far = new Date(Date.now() + 60 * 86_400_000).toISOString();
    const { container } = render(
      <>
        <DueChip deadline="2020-01-01T00:00:00Z" completed />
        <DueChip deadline="2020-01-01T00:00:00Z" />
        <DueChip deadline={tomorrow} className="soon" />
        <DueChip deadline={far} />
      </>,
    );
    const chips = Array.from(container.querySelectorAll('[data-slot="due-chip"]'));
    expect(chips[0].textContent).toContain("Completed");
    expect(chips[0].textContent).not.toContain("over");
    expect(chips[0].getAttribute("title")).toMatch(/^Was due .*1/);
    expect(chips[1].className).toContain("bg-deficit/12");
    expect(chips[2].className).toContain("text-deficit");
    expect(chips[2].className).not.toContain("bg-deficit/12");
    expect(chips[3].className).toContain("text-muted-foreground");
  });

  it("measures effort", () => {
    render(
      <>
        <EffortBar worked={0} remaining={0} label="Empty" />
        <EffortBar worked={60} remaining={0} label="Done" size="md" className="x" />
        <EffortBar worked={30} remaining={90} />
      </>,
    );
    expect(screen.getByRole("progressbar", { name: "Empty" }).getAttribute("aria-valuenow")).toBe("0");
    const done = screen.getByRole("progressbar", { name: "Done" });
    expect(done.getAttribute("aria-valuenow")).toBe("100");
    expect((done.firstChild as HTMLElement).className).toContain("bg-surplus");
    expect(screen.getByRole("progressbar", { name: "Effort put in" }).getAttribute("aria-valuenow")).toBe("25");
  });

  it("renders date leaves, verdicts and status dots", () => {
    const { container } = render(
      <>
        <DateLeaf date="2026-10-02T12:00:00Z" urgent className="x" />
        <DateLeaf date={new Date("2026-10-03T12:00:00Z")} />
        <VerdictBadge tone="fits">Fits</VerdictBadge>
        <VerdictBadge tone="over" className="x">Over</VerdictBadge>
        <VerdictBadge tone="neutral">Neutral</VerdictBadge>
        <StatusDot status="Overdue" className="x" />
      </>,
    );
    expect(container.querySelector(".border-deficit\\/40")).not.toBeNull();
    expect(screen.getByText("Fits").className).toContain("text-surplus");
    expect(screen.getByText("Over").className).toContain("text-deficit");
    expect(screen.getByText("Neutral").className).toContain("bg-muted");
    expect(screen.getByText("Overdue")).toBeTruthy();
  });

  it("renders task lines", () => {
    render(
      <ul>
        <TaskLine task={task} trailing={<span>Trail</span>} className="x" />
        <TaskLine task={{ ...task, id: "done", title: "Done task", status: "Completed", remainingDuration: 0, course: undefined }} href="/custom" />
        <TaskLine task={{ ...task, id: "low", title: "Low task", priority: "Low" }} showEffort={false} />
      </ul>,
    );
    const first = screen.getByRole("link", { name: /Read algorithms/ });
    expect(first.getAttribute("href")).toBe("/tasks/task-1");
    expect(first.textContent).toContain("High");
    expect(first.textContent).toContain("1h 30m left");
    expect(first.textContent).toContain("Trail");
    const done = screen.getByRole("link", { name: /Done task/ });
    expect(done.getAttribute("href")).toBe("/custom");
    expect(done.textContent).toContain("Done");
    expect(done.textContent).not.toContain("High");
    const low = screen.getByRole("link", { name: /Low task/ });
    expect(low.querySelector('[role="progressbar"]')).toBeNull();
  });

  it("renders setting rows and step flows", () => {
    render(
      <>
        <SettingRow label="Labelled" htmlFor="field" description="Explains">
          <input id="field" />
        </SettingRow>
        <SettingRow label="Unlabelled" className="x">
          <span>Control</span>
        </SettingRow>
        <StepFlow steps={["Connect", "Review", "Done"]} current={1} label="Import" className="x" />
        <StepFlow steps={["One"]} current={0} />
      </>,
    );
    expect(screen.getByLabelText("Labelled")).toBeTruthy();
    expect(screen.getByText("Explains")).toBeTruthy();
    expect(screen.getByText("Unlabelled").tagName).toBe("P");
    const flow = screen.getByRole("list", { name: "Import" });
    const items = flow.querySelectorAll("li");
    expect(items[0].textContent).toContain("(done)");
    expect(items[1].getAttribute("aria-current")).toBe("step");
    expect(items[2].getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("list", { name: "Progress" })).toBeTruthy();
  });
});
