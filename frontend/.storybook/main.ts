import type { StorybookConfig } from "@storybook/nextjs-vite";
import { mergeConfig } from "vite";

const config: StorybookConfig = {
  framework: "@storybook/nextjs-vite",
  stories: ["../stories/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y", "@storybook/addon-vitest", "msw-storybook-addon"],
  staticDirs: ["../public", "./public"],
  viteFinal: (config) => mergeConfig(config, {
    optimizeDeps: { include: ["msw-storybook-addon/csf3", "msw/browser", "mockdate", "swr"] },
  }),
};

export default config;
