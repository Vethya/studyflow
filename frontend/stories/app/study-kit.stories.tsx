import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { DateLeaf, DueChip, EffortBar, SectionLabel, SettingRow, StatusDot, StepFlow, TaskLine, VerdictBadge } from "@/components/study-kit";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { task } from "../fixtures";

const meta = { title: "App/study-kit", component: SectionLabel, parameters: { app: true }, args: { children: "Due this week" } } satisfies Meta<typeof SectionLabel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Label: Story = { args: { action: <Button size="xs" variant="ghost">See all</Button> } };
export const Facts: Story = { render: () => <div className="grid max-w-md gap-4">
  <div className="flex flex-wrap items-center gap-3"><DueChip deadline={task.deadline} /><DueChip deadline="2026-10-16T10:00:00Z" /><DueChip deadline="2026-10-14T10:00:00Z" /><DueChip deadline="2026-10-14T10:00:00Z" completed /></div>
  <div className="flex items-center gap-3"><DateLeaf date={task.deadline} /><DateLeaf date="2026-10-16T10:00:00Z" urgent /></div>
  <div className="flex flex-wrap gap-2"><VerdictBadge tone="fits">On track</VerdictBadge><VerdictBadge tone="over">Over by 2h</VerdictBadge><VerdictBadge tone="neutral">No plan yet</VerdictBadge></div>
  <div className="flex gap-4"><StatusDot status="Not Started" /><StatusDot status="In Progress" /><StatusDot status="Completed" /><StatusDot status="Overdue" /></div>
  <EffortBar worked={30} remaining={90} /><EffortBar worked={120} remaining={0} size="md" label="Effort on the essay" />
  <StepFlow steps={["Connect", "Review", "Done"]} current={1} label="Import progress" />
</div> };
export const TaskLines: Story = { render: () => <ul className="max-w-xl divide-y rounded-xl border bg-card"><TaskLine task={task} /><TaskLine task={{ ...task, id: "lab", title: "Write lab report", category: "Assignment", priority: "Medium", course: undefined, status: "Completed", remainingDuration: 0 }} /></ul> };
export const SettingRows: Story = { render: () => <div className="max-w-2xl"><SettingRow label="Study reminders" description="Remind me when a session needs an outcome." htmlFor="reminders"><Switch id="reminders" defaultChecked /></SettingRow><SettingRow label="Time zone" description="Asia/Phnom_Penh"><Button variant="outline" size="sm">Change</Button></SettingRow></div> };
