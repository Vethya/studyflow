import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { SlidingIndicator, useSlidingIndicator } from "@/components/ui/sliding-indicator";
import { Button } from "@/components/ui/button";


const meta = { title: "UI/Sliding-indicator", component: SlidingIndicator, args: { indicator: { top: 0, left: 0, width: 80, height: 32, ready: true } } } satisfies Meta<typeof SlidingIndicator>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Interactive: Story = { render: function Render() {
  const [active, setActive] = useState("Tasks");
  const { containerRef, indicator } = useSlidingIndicator<HTMLDivElement>({ activeKey: active });
  return <div ref={containerRef} className="relative flex w-fit gap-2"><SlidingIndicator indicator={indicator} />{["Tasks", "Calendar", "Progress"].map((label) => <Button className="relative z-10" variant="ghost" key={label} data-active={active === label ? "true" : undefined} onClick={() => setActive(label)}>{label}</Button>)}</div>;
} };
