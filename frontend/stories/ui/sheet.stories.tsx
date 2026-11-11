import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter, SheetClose } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { expect, userEvent, waitFor, within } from "storybook/test";


const meta = { title: "UI/Sheet", component: Sheet, args: {  } } satisfies Meta<typeof Sheet>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: (args) => <Sheet {...args}>
  <SheetTrigger render={<Button />}>Task details</SheetTrigger>
  <SheetContent><SheetHeader><SheetTitle>Task details</SheetTitle><SheetDescription>Change your coursework details.</SheetDescription></SheetHeader>
    <p>Read cognitive science paper</p><SheetFooter><SheetClose render={<Button variant="outline" />}>Done</SheetClose></SheetFooter>
  </SheetContent>
</Sheet>, play: async ({ canvasElement }) => {
  await userEvent.click(within(canvasElement).getByRole("button", { name: "Task details" }));
  const dialog = await within(document.body).findByRole("dialog");
  await waitFor(() => expect(within(dialog).getByText("Read cognitive science paper")).toBeVisible());
  await userEvent.click(within(dialog).getByRole("button", { name: "Done" }));
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
} };
