"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute={["class", "data-theme"]}
      defaultTheme="system"
      enableColorScheme
      enableSystem
      disableTransitionOnChange
      themes={["light", "dark", "amoled"]}
      storageKey="studyflow-theme"
    >
      {children}
    </NextThemesProvider>
  );
}
