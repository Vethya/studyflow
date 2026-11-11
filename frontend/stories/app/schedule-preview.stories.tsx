import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SchedulePreview, ProposalCalendar, PendingPlanBanner } from "@/components/schedule-preview";
import { DialogDemo } from "../dialog-demo";
import { proposal, sessions } from "../fixtures";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

const meta = { title: "App/schedule-preview", component: SchedulePreview, parameters: { app: true }, args: { proposal, open: false, onOpenChange: fn(), onAccepted: fn(), onRejected: fn(), existingSessions: [] } } satisfies Meta<typeof SchedulePreview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Review: Story = { render: (args) => <DialogDemo label="Review plan">{(open, onOpenChange) => <SchedulePreview {...args} open={open} onOpenChange={onOpenChange} />}</DialogDemo>, play: async ({ canvasElement }) => { await userEvent.click(await within(canvasElement).findByRole("button", { name: "Review plan" })); } };
export const Accept: Story = { ...Review, play: async (context) => {
  await Review.play!(context);
  const dialog = within(await within(document.body).findByRole("dialog"));
  await userEvent.click(dialog.getByRole("button", { name: /Use this plan/ }));
  await waitFor(() => expect(context.args.onAccepted).toHaveBeenCalledOnce());
} };
export const Revision: Story = { ...Review, args: { proposal: { ...proposal, reason: "A missed session needs a new place." }, existingSessions: [sessions[0]] } };
export const PendingBanner: Story = { render: () => <PendingPlanBanner proposal={{ ...proposal, reason: "A missed session needs a new place." }} onReview={fn()} /> };
export const Calendar: Story = { render: () => <ProposalCalendar isRecoveryProposal proposedSessions={proposal.proposedSessions} recordedSessions={[{ ...sessions[0], outcome: "Missed" }]} /> };
export const SaveError: Story = { ...Review, parameters: { api: { state: "error" } }, play: async (context) => {
  await Review.play!(context);
  const dialog = within(await within(document.body).findByRole("dialog"));
  await userEvent.click(dialog.getByRole("button", { name: /Use this plan/ }));
  await expect(await within(document.body).findByText(/service temporarily unavailable/)).toBeInTheDocument();
  await expect(context.args.onAccepted).not.toHaveBeenCalled();
  await expect(dialog.getByRole("button", { name: /Use this plan/ })).toBeEnabled();
} };
