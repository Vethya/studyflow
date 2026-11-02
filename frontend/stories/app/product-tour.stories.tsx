import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ProductTour } from "@/components/product-tour";
import { Button } from "@/components/ui/button";
import { startProductTour } from "@/lib/onboarding";
import { expect, userEvent, waitFor, within } from "storybook/test";

const meta = { title: "App/product-tour", component: ProductTour, parameters: { app: true }, args: {  } } satisfies Meta<typeof ProductTour>;
export default meta;
type Story = StoryObj<typeof meta>;

// The tour opens once per account, so replay it explicitly. The request is
// retried because the tour only listens once the session providers have mounted it.
async function openTour() {
  const body = within(document.body);
  await waitFor(() => {
    if (!body.queryByRole("dialog")) startProductTour();
    expect(body.getByRole("dialog", { name: "Welcome to StudyFlow" })).toBeInTheDocument();
  }, { timeout: 5000 });
  return body;
}

export const Welcome: Story = { play: async () => {
  const dialog = (await openTour()).getByRole("dialog", { name: "Welcome to StudyFlow" });
  await waitFor(() => expect(dialog).toBeVisible());
} };
export const Spotlight: Story = { render: () => <><Button variant="outline" data-tour="nav-dashboard">Dashboard</Button><ProductTour /></>, play: async () => {
  const body = await openTour();
  await userEvent.click(body.getByRole("button", { name: /Start the tour/ }));
  const dialog = await body.findByRole("dialog", { name: "Dashboard" });
  await waitFor(() => expect(dialog).toBeVisible());
  await expect(await body.findByTestId("tour-spotlight")).toBeInTheDocument();
} };
