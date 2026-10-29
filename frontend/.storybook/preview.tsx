import type { Preview } from "@storybook/nextjs-vite";
import { Title, Subtitle, Description, Primary, Controls } from "@storybook/addon-docs/blocks";
import { useEffect } from "react";
import { useTheme } from "next-themes";
import { INITIAL_VIEWPORTS } from "storybook/viewport";
import { mswLoader } from "msw-storybook-addon/csf3";
import MockDate from "mockdate";
import { NOW } from "../stories/fixtures";
import { apiHandler, resetApi } from "../stories/mock-api";
import { StoryProviders } from "../stories/providers";
import { restartOnboarding } from "../lib/onboarding";
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
  loaders: [mswLoader()],
  beforeEach: (context) => {
    MockDate.set(NOW);
    resetApi(context.parameters.api);
    const keys = ["studyflow:welcome-seen", "studyflow:getting-started-hidden"];
    const saved = keys.map((key) => localStorage.getItem(key));
    restartOnboarding();
    return () => { MockDate.reset(); restartOnboarding(); keys.forEach((key, i) => saved[i] === null ? localStorage.removeItem(key) : localStorage.setItem(key, saved[i]!)); };
  },
  globalTypes: {
    theme: { description: "App theme", toolbar: { icon: "paintbrush", items: ["light", "dark", "amoled"], dynamicTitle: true } },
  },
  initialGlobals: { theme: "light" },
  parameters: {
    docs: {
      story: { inline: false, iframeHeight: 700 },
      page: () => <><Title /><Subtitle /><Description /><Primary /><Controls /></>,
    },
    nextjs: { appDirectory: true },
    msw: [apiHandler],
    viewport: { options: INITIAL_VIEWPORTS },
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    a11y: { test: "todo" },
  },
  decorators: [(Story, context) => (
    <ThemeProvider>
      <ThemeSync theme={context.globals.theme} />
      <TooltipProvider>
        <div className="min-h-screen bg-background p-6 font-sans text-foreground antialiased">
          {context.parameters.app ? <StoryProviders key={context.id}><Story /></StoryProviders> : <Story />}
          <Toaster position="bottom-right" richColors />
        </div>
      </TooltipProvider>
    </ThemeProvider>
  )],
};

export default preview;
