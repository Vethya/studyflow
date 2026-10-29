import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { LegalPage, LegalSection } from "@/components/legal-page";

const meta = { title: "App/legal-page", component: LegalPage, parameters: { app: true }, args: { title: "Privacy policy", intro: "How StudyFlow handles your study data.", children: null } } satisfies Meta<typeof LegalPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: (args) => <LegalPage {...args}><LegalSection title="Your study data"><p>Your coursework and study preferences belong to your student account.</p></LegalSection></LegalPage> };
