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
      storageKey="studyflow-theme"
    >
      {children}
    </NextThemesProvider>
  );
}
