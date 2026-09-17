"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, MoonStar, Sun } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const THEME_OPTIONS = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "amoled", label: "AMOLED", Icon: MoonStar },
] as const;

type ThemeName = (typeof THEME_OPTIONS)[number]["value"];

export function ThemeOptionIcon({
  theme,
  className,
}: {
  theme: string;
  className?: string;
}) {
  const option = THEME_OPTIONS.find(({ value }) => value === theme) ?? THEME_OPTIONS[0];
  return <option.Icon className={className ?? "size-4"} aria-hidden />;
}

export function ThemeSelector() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  if (!mounted) {
    return <Skeleton className="h-7 w-28" />;
  }

  return (
    <Select
      value={theme ?? "system"}
      onValueChange={(value) => value && setTheme(value as ThemeName)}
    >
      <SelectTrigger className="w-32" aria-label="Theme">
        <SelectValue>
          {(selected) => {
            const option = THEME_OPTIONS.find(({ value }) => value === selected) ?? THEME_OPTIONS[0];
            return (
              <>
                <option.Icon className="size-4 text-muted-foreground" aria-hidden />
                <span className="shrink-0 whitespace-nowrap">{option.label}</span>
              </>
            );
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {THEME_OPTIONS.map(({ value, label, Icon }) => (
          <SelectItem key={value} value={value}>
            <Icon className="size-4 text-muted-foreground" aria-hidden />
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
