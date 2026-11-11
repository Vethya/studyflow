import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Tabs, TabsList, TabsTrigger, TabsContent, TabsIndicator } from "@/components/ui/tabs";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";


const meta = { title: "UI/Tabs", component: Tabs, args: { defaultValue: "upcoming", onValueChange: fn() } } satisfies Meta<typeof Tabs>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: (args) => <Tabs {...args}><TabsList><TabsTrigger value="upcoming">Upcoming</TabsTrigger><TabsTrigger value="completed">Completed</TabsTrigger><TabsIndicator /></TabsList><TabsContent value="upcoming">Your next study sessions</TabsContent><TabsContent value="completed">Finished coursework</TabsContent></Tabs>, play: async ({ canvasElement, args }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole("tab", { name: "Completed" }));
  await waitFor(() => expect(canvas.getByRole("tabpanel", { name: "Completed" })).toHaveTextContent("Finished coursework"));
  await expect(args.onValueChange).toHaveBeenCalled();
} };
