import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Avatar, AvatarImage, AvatarFallback, AvatarBadge, AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar";


const meta = { title: "UI/Avatar", component: Avatar, args: {  } } satisfies Meta<typeof Avatar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Fallback: Story = { render: (args) => <Avatar {...args}><AvatarFallback>AS</AvatarFallback></Avatar> };
export const Image: Story = { render: (args) => <Avatar {...args}><AvatarImage alt="Alex Student" src="/landing/pixel-flower.png" /><AvatarFallback>AS</AvatarFallback><AvatarBadge /></Avatar> };
export const Group: Story = { render: () => <AvatarGroup><Avatar><AvatarFallback>AS</AvatarFallback></Avatar><Avatar><AvatarFallback>JL</AvatarFallback></Avatar><AvatarGroupCount>+3</AvatarGroupCount></AvatarGroup> };
