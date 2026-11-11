import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useConfirmDeleteTask } from "@/components/use-confirm-delete-task";
import { Button } from "@/components/ui/button";
import { task } from "../fixtures";
import { expect, fn, userEvent, within } from "storybook/test";

function Demo({ onDelete }: { onDelete: (taskId: string) => void }) {
  const { requestDelete, dialog } = useConfirmDeleteTask((target) => onDelete(target.id));
  return (
    <>
      <Button variant="destructive" onClick={() => requestDelete(task)}>
        Delete
      </Button>
      {dialog}
    </>
  );
}

const meta = {
  title: "App/use-confirm-delete-task",
  component: Demo,
  args: { onDelete: fn() },
} satisfies Meta<typeof Demo>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Confirm: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Delete" }));
    const dialog = await within(document.body).findByRole("dialog");
    await expect(within(dialog).getByText(`Delete “${task.title}”?`)).toBeVisible();
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete task" }));
    await expect(args.onDelete).toHaveBeenCalledWith(task.id);
  },
};

export const Cancel: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Delete" }));
    const dialog = await within(document.body).findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await expect(args.onDelete).not.toHaveBeenCalled();
  },
};
