"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({ children, nonce }: { children: React.ReactNode; nonce?: string }) {
  return (
    <NextThemesProvider
      attribute={["class", "data-theme"]}
      defaultTheme="system"
      enableColorScheme
      enableSystem
      disableTransitionOnChange
      themes={["light", "dark", "amoled"]}
      storageKey="studyflow-theme"
      // The inline theme script runs under the per-request CSP nonce.
      nonce={nonce}
    >
      {children}
    </NextThemesProvider>
  );
}
