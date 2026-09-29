/**
 * Cross-platform StudyFlow design tokens.
 *
 * The web theme is authored in OKLCH CSS variables. React Native cannot
 * consume those values directly, so these semantic values are the mobile
 * equivalents and remain intentionally named after the web roles.
 */
export const colors = {
  light: {
    background: "#F7F8FA",
    foreground: "#2B2D32",
    card: "#FFFFFF",
    muted: "#F0F2F5",
    mutedForeground: "#687080",
    border: "#DDE1E7",
    primary: "#383B44",
    primaryForeground: "#F9FAFB",
    accent: "#ECEEF2",
    surplus: "#2E8D7B",
    surplusSoft: "#E5F3EF",
    deficit: "#C4542F",
    deficitSoft: "#F9E9E3",
    warning: "#B97816",
  },
  dark: {
    background: "#2F323B",
    foreground: "#F2F4F7",
    card: "#3A3E48",
    muted: "#484D59",
    mutedForeground: "#B1B7C2",
    border: "#5A606C",
    primary: "#EEF0F3",
    primaryForeground: "#30333C",
    accent: "#505662",
    surplus: "#75C6B2",
    surplusSoft: "#314F4A",
    deficit: "#E99A7F",
    deficitSoft: "#573A34",
    warning: "#E7B96E",
  },
  amoled: {
    background: "#000000",
    foreground: "#F2F4F7",
    card: "#0E0E11",
    muted: "#1B1C20",
    mutedForeground: "#B1B7C2",
    border: "#303239",
    primary: "#EEF0F3",
    primaryForeground: "#050507",
    accent: "#24262D",
    surplus: "#75C6B2",
    surplusSoft: "#18322E",
    deficit: "#E99A7F",
    deficitSoft: "#3A211C",
    warning: "#E7B96E",
  },
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  pill: 999,
} as const;

export const typography = {
  body: 16,
  bodySmall: 14,
  caption: 12,
  title: 24,
  section: 17,
} as const;

export const motion = {
  fast: 150,
  normal: 220,
  sheet: 280,
  progress: 600,
} as const;

export type ThemeName = keyof typeof colors;
