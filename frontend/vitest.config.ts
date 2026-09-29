import path from "node:path";
import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: {
    environment: "jsdom",
    exclude: [...configDefaults.exclude, "e2e/**"],
    coverage: {
      provider: "v8",
      include: [
        "app/**/*.{ts,tsx}",
        "components/**/*.{ts,tsx}",
        "hooks/**/*.{ts,tsx}",
        "lib/**/*.{ts,tsx}",
      ],
      exclude: [
        "**/*.test.*",
        "**/*.spec.*",
        "**/*.d.ts",
        "**/e2e/**",
        "**/benchmarks/**",
        "**/{next,playwright,postcss,eslint,vitest}.config.*",
      ],
      reporter: ["text", "json", "json-summary", "html"],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
