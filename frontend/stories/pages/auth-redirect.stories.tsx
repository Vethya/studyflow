import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import GoogleSignInLanding from "@/app/app/page";
import { redirect } from "@storybook/nextjs-vite/navigation.mock";
import { expect } from "storybook/test";

const meta = { title: "Pages/auth/callback-redirect", parameters: { docs: { description: { component: "The /app callback has no UI. This story verifies its redirect to /dashboard." } } } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const RedirectToDashboard: Story = {
  render: () => <p>The Google sign-in callback redirects to /dashboard.</p>,
  play: async () => {
    expect(() => GoogleSignInLanding()).toThrow();
    await expect(redirect).toHaveBeenCalledWith("/dashboard");
  },
};
