import type { Preview } from "@storybook/nextjs-vite";
import { useEffect } from "react";
import { useTheme } from "next-themes";
import { INITIAL_VIEWPORTS } from "storybook/viewport";
import { ThemeProvider } from "../components/theme-provider";
import { TooltipProvider } from "../components/ui/tooltip";
import { Toaster } from "../components/ui/sonner";
import "../app/globals.css";
import "./preview.css";

function ThemeSync({ theme }: { theme: string }) {
  const { setTheme } = useTheme();
  useEffect(() => { setTheme(theme); }, [theme, setTheme]);
  return null;
}

const preview: Preview = {
  tags: ["autodocs"],
  globalTypes: {
    theme: { description: "App theme", toolbar: { icon: "paintbrush", items: ["light", "dark", "amoled"], dynamicTitle: true } },
  },
  initialGlobals: { theme: "light" },
  parameters: {
    nextjs: { appDirectory: true },
    viewport: { options: INITIAL_VIEWPORTS },
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    a11y: { test: "todo" },
  },
  decorators: [(Story, context) => (
    <ThemeProvider>
      <ThemeSync theme={context.globals.theme} />
      <TooltipProvider>
        <div className="min-h-screen bg-background p-6 font-sans text-foreground antialiased">
          <Story />
          <Toaster position="bottom-right" richColors />
        </div>
      </TooltipProvider>
    </ThemeProvider>
  )],
};

export default preview;
