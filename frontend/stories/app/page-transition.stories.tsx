import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { PageTransition } from "@/components/page-transition";
import { Button } from "@/components/ui/button";
import { expect, userEvent, within } from "storybook/test";

const meta = { title: "App/page-transition", component: PageTransition, args: { id: "/dashboard", children: <p>Dashboard content</p> } } satisfies Meta<typeof PageTransition>;
export default meta;
type Story = StoryObj<typeof meta>;

function Navigator() {
  const [page, setPage] = useState("Dashboard");
  return <div className="space-y-4">
    <div className="flex gap-2">{["Dashboard", "Tasks"].map((name) => <Button key={name} variant={page === name ? "default" : "outline"} onClick={() => setPage(name)}>{name}</Button>)}</div>
    <PageTransition id={page}><p className="rounded-xl border bg-card p-6">{page} content</p></PageTransition>
  </div>;
}

export const Default: Story = {};
export const Navigation: Story = { render: () => <Navigator />, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole("button", { name: "Tasks" }));
  await expect(await canvas.findByText("Tasks content")).toBeInTheDocument();
} };
