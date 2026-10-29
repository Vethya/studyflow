import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { expect, userEvent, waitFor, within } from "storybook/test";


const meta = { title: "UI/Collapsible", component: Collapsible, args: {  } } satisfies Meta<typeof Collapsible>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: (args) => <Collapsible {...args}><CollapsibleTrigger render={<Button variant="ghost" />}>Show notes</CollapsibleTrigger><CollapsibleContent>Highlight the main findings.</CollapsibleContent></Collapsible>, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole("button", { name: "Show notes" }));
  await waitFor(() => expect(canvas.getByText("Highlight the main findings.")).toBeVisible());
} };
export const Open: Story = { ...Default, args: { defaultOpen: true }, play: undefined };
