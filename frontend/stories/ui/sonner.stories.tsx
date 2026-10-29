import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { expect, userEvent, waitFor, within } from "storybook/test";


const meta = { title: "UI/Sonner", component: Toaster, args: {  } } satisfies Meta<typeof Toaster>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Notifications: Story = { render: () => <div className="flex gap-3"><Button onClick={() => toast.success("Task saved")}>Success</Button><Button variant="outline" onClick={() => toast.error("Could not save task")}>Error</Button><Button variant="ghost" onClick={() => toast("Study plan updated")}>Information</Button></div>, play: async ({ canvasElement }) => {
  await userEvent.click(within(canvasElement).getByRole("button", { name: "Success" }));
  await waitFor(() => expect(within(document.body).getByText("Task saved")).toBeVisible());
  toast.dismiss();
} };
