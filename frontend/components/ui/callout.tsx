"use client";

import * as React from "react";
import { AlertTriangle, CalendarOff, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The single notice component for the whole product.
 *
 * Before this existed every page invented its own: the dashboard used a filled
 * `Alert`, Progress used a dashed muted box, Availability used a bare icon and
 * a line of text, and the overload warnings used a solid salmon card.
 *
 * One shape now: an ordinary card. Tone is carried by the icon alone — no
 * accent bar down the edge, no tinted fill. A coloured rule bolted to the side
 * of a card is decoration pretending to be information; the icon already says
 * what kind of notice this is, and the border stays the same weight as every
 * other card on the page so a warning does not out-shout the content.
 */
const TONES = {
  info: {
    icon: "text-muted-foreground",
    title: "text-foreground",
    Icon: Info,
  },
  warning: {
    icon: "text-deficit",
    title: "text-foreground",
    Icon: AlertTriangle,
  },
  danger: {
    icon: "text-deficit",
    title: "text-deficit",
    Icon: AlertTriangle,
  },
  success: {
    icon: "text-surplus",
    title: "text-foreground",
    Icon: CheckCircle2,
  },
  blocked: {
    icon: "text-muted-foreground",
    title: "text-foreground",
    Icon: CalendarOff,
  },
} as const;

export type CalloutTone = keyof typeof TONES;

export function Callout({
  tone = "info",
  title,
  icon,
  actions,
  className,
  children,
}: {
  tone?: CalloutTone;
  title?: React.ReactNode;
  /** Overrides the tone's default glyph. */
  icon?: React.ElementType;
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  const config = TONES[tone];
  const Icon = icon ?? config.Icon;

  return (
    <div
      role={tone === "danger" || tone === "warning" ? "alert" : undefined}
      className={cn("rounded-lg border bg-card px-4 py-3", className)}
    >
      <div className="flex items-start gap-3">
        <Icon className={cn("mt-0.5 size-4 shrink-0", config.icon)} aria-hidden />

        <div className="min-w-0 flex-1">
          {title && (
            <p className={cn("text-sm font-medium leading-snug", config.title)}>{title}</p>
          )}
          {children && (
            <div
              className={cn(
                "text-sm leading-relaxed text-muted-foreground",
                title && "mt-1",
              )}
            >
              {children}
            </div>
          )}
          {actions && <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      </div>
    </div>
  );
}
