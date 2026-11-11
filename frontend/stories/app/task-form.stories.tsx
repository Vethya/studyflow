import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TaskFormDialog } from "@/components/task-form-dialog";
import { DialogDemo } from "../dialog-demo";
import { task } from "../fixtures";
import { requests } from "../mock-api";
import { expect, fireEvent, fn, userEvent, waitFor, within } from "storybook/test";

const meta = { title: "App/task-form", component: TaskFormDialog, parameters: { app: true }, args: { open: false, onOpenChange: fn(), onSaved: fn() } } satisfies Meta<typeof TaskFormDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Create: Story = { render: (args) => <DialogDemo label="Open task form">{(open, onOpenChange) => <TaskFormDialog {...args} open={open} onOpenChange={onOpenChange} />}</DialogDemo>, play: async ({ canvasElement, args }) => {
  await userEvent.click(await within(canvasElement).findByRole("button", { name: "Open task form" }));
  const dialog = within(await within(document.body).findByRole("dialog"));
  await userEvent.type(dialog.getByLabelText("Title"), "Draft history essay");
  fireEvent.change(dialog.getByLabelText("Deadline"), { target: { value: "2026-10-21T21:00" } });
  await userEvent.click(dialog.getByRole("button", { name: "Add task" }));
  await waitFor(() => expect(args.onSaved).toHaveBeenCalledOnce());
  await expect(requests.find((r) => r.method === "POST" && r.path === "/tasks")?.body).toMatchObject({ title: "Draft history essay" });
} };
export const Edit: Story = { ...Create, args: { task }, play: async ({ canvasElement }) => { await userEvent.click(await within(canvasElement).findByRole("button", { name: "Open task form" })); } };
export const FrozenEstimate: Story = { ...Edit, args: { task: { ...task, estimateFrozen: true, status: "In Progress" } } };
export const NoHistory: Story = { ...Edit, parameters: { api: { adaptive: false } } };
export const SaveError: Story = { ...Create, parameters: { api: { state: "error" } }, play: async ({ canvasElement }) => {
  await userEvent.click(await within(canvasElement).findByRole("button", { name: "Open task form" }));
  const dialog = within(await within(document.body).findByRole("dialog"));
  await userEvent.type(dialog.getByLabelText("Title"), "Draft history essay");
  fireEvent.change(dialog.getByLabelText("Deadline"), { target: { value: "2026-10-21T21:00" } });
  await userEvent.click(dialog.getByRole("button", { name: "Add task" }));
  await expect(await within(document.body).findByText(/service temporarily unavailable/)).toBeInTheDocument();
} };
