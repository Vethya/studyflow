import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { PasswordInput } from "@/components/ui/password-input";
import { expect, fn, userEvent, within } from "storybook/test";


const meta = { title: "UI/Password-input", component: PasswordInput, args: { "aria-label": "Password", defaultValue: "studyflow-demo" } } satisfies Meta<typeof PasswordInput>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByLabelText("Password")).toHaveAttribute("type", "password");
  await userEvent.click(canvas.getByRole("button", { name: "Show password" }));
  await expect(canvas.getByLabelText("Password")).toHaveAttribute("type", "text");
  await userEvent.click(canvas.getByRole("button", { name: "Hide password" }));
  await expect(canvas.getByLabelText("Password")).toHaveAttribute("type", "password");
} };
export const Disabled: Story = { args: { disabled: true } };
