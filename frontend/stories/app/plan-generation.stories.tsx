import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { PlanGenerationDialog } from "@/components/plan-generation-dialog";

const meta = { title: "App/plan-generation", component: PlanGenerationDialog, parameters: { app: true }, args: { open: true } } satisfies Meta<typeof PlanGenerationDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Building: Story = {};
export const Closed: Story = { args: { open: false } };
