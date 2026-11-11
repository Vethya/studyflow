import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { AdaptiveEstimateNote, PersistedEstimateNote, LargeAdjustmentDialog } from "@/components/adaptive-estimate";
import { DialogDemo } from "../dialog-demo";
import { estimate } from "../fixtures";
import { fn } from "storybook/test";

const meta = { title: "App/adaptive-estimate", component: AdaptiveEstimateNote, parameters: { app: true }, args: { estimate, onChoose: fn() } } satisfies Meta<typeof AdaptiveEstimateNote>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Suggestion: Story = { render: function Render(args) {
  const [source, setSource] = useState("adaptive");
  return <AdaptiveEstimateNote {...args} estimate={{ ...args.estimate, plannedDuration: source === "adaptive" ? args.estimate.adaptiveEstimate : args.estimate.originalEstimate }} onChoose={(which) => { setSource(which); args.onChoose?.(which); }} />;
} };
export const Faster: Story = { ...Suggestion, args: { estimate: { ...estimate, adaptiveEstimate: 90, plannedDuration: 90, factor: 0.75 } } };
export const Saved: Story = { render: () => <PersistedEstimateNote originalEstimate={120} adaptiveEstimate={150} plannedDuration={150} plannedSource="Adaptive" /> };
export const LargeAdjustment: Story = { render: () => <DialogDemo label="Review adjustment">{(open, onOpenChange) => <LargeAdjustmentDialog estimate={{ ...estimate, adaptiveEstimate: 360, plannedDuration: 360, factor: 3, needsAcknowledgment: true }} open={open} onOpenChange={onOpenChange} onDecided={fn()} />}</DialogDemo> };
