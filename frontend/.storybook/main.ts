import type { StorybookConfig } from "@storybook/nextjs-vite";
import { mergeConfig } from "vite";
import packageJson from "../package.json" with { type: "json" };

const config: StorybookConfig = {
  framework: "@storybook/nextjs-vite",
  stories: ["../stories/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y", "@storybook/addon-vitest", "msw-storybook-addon"],
  staticDirs: ["../public", "./public"],
  viteFinal: (config) => mergeConfig(config, {
    optimizeDeps: { include: [
      ...Object.keys(packageJson.dependencies).filter((name) => !["next", "tw-animate-css"].includes(name)),
      "msw-storybook-addon/csf3", "msw/browser", "mockdate",
      "@base-ui/react/**", "gsap/dist/ScrollTrigger", "next/link", "next/image",
    ] },
  }),
};

export default config;
