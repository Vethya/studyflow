"use client";

/**
 * Applies a theme change wrapped in document.startViewTransition
 * for a smooth crossfade if supported by the browser, or falls back to
 * direct state update.
 *
 * NOTE: next-themes sets state in React, which runs its DOM mutation
 * in a useEffect *after* the render cycle. If we rely solely on setTheme,
 * startViewTransition's callback finishes synchronously before the DOM changes,
 * taking identical snapshots and causing an instant flick later.
 * To get a real, buttery-smooth crossfade, we apply the class/data-theme
 * to document.documentElement synchronously inside startViewTransition.
 */
export function applyThemeWithTransition(
  nextTheme: string,
  setTheme: (theme: string) => void,
) {
  if (
    typeof document === "undefined" ||
    !("startViewTransition" in document) ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    setTheme(nextTheme);
    return;
  }

  const doc = document as Document & {
    startViewTransition: (updateCallback: () => void | Promise<void>) => void;
  };

  doc.startViewTransition(() => {
    const root = document.documentElement;
    const resolved =
      nextTheme === "system"
        ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
        : nextTheme;

    root.classList.remove("light", "dark", "amoled");
    if (resolved !== "light") {
      root.classList.add(resolved);
    }
    root.setAttribute("data-theme", resolved);
    root.style.colorScheme = resolved === "light" ? "light" : "dark";

    setTheme(nextTheme);
  });
}
