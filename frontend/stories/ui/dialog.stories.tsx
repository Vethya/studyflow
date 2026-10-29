import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { expect, userEvent, waitFor, within } from "storybook/test";


const meta = { title: "UI/Dialog", component: Dialog, args: {  } } satisfies Meta<typeof Dialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: (args) => <Dialog {...args}>
  <DialogTrigger render={<Button />}>Edit task</DialogTrigger>
  <DialogContent><DialogHeader><DialogTitle>Edit task</DialogTitle><DialogDescription>Change your coursework details.</DialogDescription></DialogHeader>
    <p>Read cognitive science paper</p><DialogFooter><DialogClose render={<Button variant="outline" />}>Done</DialogClose></DialogFooter>
  </DialogContent>
</Dialog>, play: async ({ canvasElement }) => {
  await userEvent.click(within(canvasElement).getByRole("button", { name: "Edit task" }));
  const dialog = await within(document.body).findByRole("dialog");
  await waitFor(() => expect(within(dialog).getByText("Read cognitive science paper")).toBeVisible());
  await userEvent.click(within(dialog).getByRole("button", { name: "Done" }));
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
} };
