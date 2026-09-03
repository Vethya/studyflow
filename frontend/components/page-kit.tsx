"use client";

import * as React from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * The structural vocabulary every screen is built from.
 *
 * Each page used to hand-roll its own header, section heading and figure tile,
 * so no two pages agreed on heading size, spacing, or where the action button
 * sat. These are those three shapes, defined once.
 */

/** Page shell: one max width, one gutter, one rhythm — used by all six screens. */
export function PageShell({
  width = "wide",
  className,
  children,
}: {
  width?: "wide" | "narrow";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full min-w-0 flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8",
        width === "wide" ? "max-w-6xl" : "max-w-4xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * `min-w-0` on the text column and `flex-wrap` on the container are what stop
 * the actions being pushed off the right edge — the bug that clipped "Add
 * window" on Availability and the "Service" tab in Settings.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0 flex-1 basis-64">
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-[1.75rem]">
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A section heading with an optional right-hand count and "see all" link. */
export function SectionHeader({
  title,
  meta,
  action,
  tone,
  className,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  action?: { href: string; label: string };
  tone?: "deficit";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b pb-2",
        className,
      )}
    >
      <h2 className="font-display text-base font-semibold tracking-tight">{title}</h2>
      <div className="flex items-baseline gap-3">
        {meta != null && (
          <span
            className={cn(
              "text-xs text-muted-foreground",
              tone === "deficit" && "font-medium text-deficit",
            )}
          >
            {meta}
          </span>
        )}
        {action && (
          <Link
            href={action.href}
            className="text-xs font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            {action.label} →
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * A single figure. `tone` is the only way colour enters a tile, and only ever
 * for a capacity signal — never for decoration.
 */
export function StatTile({
  icon: Icon,
  value,
  label,
  hint,
  tone,
}: {
  icon: React.ElementType;
  /** `null` renders the loading state. */
  value: string | null;
  label: string;
  hint?: string;
  tone?: "deficit" | "surplus";
}) {
  return (
    <div className="min-w-0 rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2">
        <Icon
          className={cn(
            "size-4 shrink-0",
            tone === "deficit"
              ? "text-deficit"
              : tone === "surplus"
                ? "text-surplus"
                : "text-muted-foreground",
          )}
          aria-hidden
        />
        <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
      </div>

      {value === null ? (
        <Skeleton className="mt-2.5 h-8 w-24" />
      ) : (
        <p
          className={cn(
            "mt-2 font-display text-[1.75rem] font-bold leading-none tabular-nums",
            tone === "deficit" && "text-deficit",
            tone === "surplus" && "text-surplus",
          )}
        >
          {value}
        </p>
      )}

      {hint && <p className="mt-1.5 truncate text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** The one empty state: a line that says what is missing and a way to fix it. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon?: React.ElementType;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center",
        className,
      )}
    >
      {Icon && <Icon className="size-6 text-muted-foreground/50" aria-hidden />}
      <div>
        <p className="text-sm font-medium">{title}</p>
        {children && (
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{children}</p>
        )}
      </div>
      {action}
    </div>
  );
}
