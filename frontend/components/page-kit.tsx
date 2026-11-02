"use client";

import * as React from "react";
import Link from "next/link";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CATEGORY_CONFIG } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Category } from "@/types";

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
        "app-page mx-auto flex w-full min-w-0 flex-col gap-6 px-4 py-6 @2xl/dashboard:px-6 @2xl/dashboard:py-7",
        width === "wide" ? "max-w-7xl" : "max-w-4xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * The title and actions both need an explicit mobile width contract. Without
 * it, a multi-button action group keeps its intrinsic width and can push page
 * controls past the viewport.
 */
export function PageHeader({
  icon: Icon,
  eyebrow,
  title,
  description,
  actions,
}: {
  icon?: React.ElementType;
  /** A short line of context above the title, such as today's date. */
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div data-slot="page-header" className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0 flex-1 basis-64">
        {(Icon || eyebrow) && (
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            {Icon && <Icon className="size-3.5 text-primary" aria-hidden />}
            {eyebrow}
          </p>
        )}
        <h1 className="wrap-break-word text-2xl leading-tight font-semibold tracking-tight @2xl/dashboard:text-[1.625rem]">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-prose wrap-break-word text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && (
        <div
          data-slot="page-header-actions"
          className="flex w-full min-w-0 max-w-full flex-wrap items-center gap-2 @2xl/dashboard:w-auto @2xl/dashboard:shrink-0"
        >
          {actions}
        </div>
      )}
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
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
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
 * Every block of content on every screen: one card, one title, an optional
 * description and one right-hand action. Pass `flush` for lists, tables and
 * grids that should meet the card's edges.
 */
export function SectionCard({
  title,
  description,
  action,
  footer,
  flush = false,
  className,
  contentClassName,
  children,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  flush?: boolean;
  className?: string;
  contentClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn("min-w-0", className)}>
      {(title || description || action) && (
        <CardHeader>
          {title && <CardTitle>{title}</CardTitle>}
          {description && <CardDescription>{description}</CardDescription>}
          {action && <CardAction>{action}</CardAction>}
        </CardHeader>
      )}
      <CardContent className={cn(flush && "overflow-hidden p-0", contentClassName)}>{children}</CardContent>
      {footer && <CardFooter>{footer}</CardFooter>}
    </Card>
  );
}

/**
 * The page's headline figures, as one card of divided cells rather than a row
 * of separate tiles — the figures belong to one question, so they read as one
 * object. Stacks on small screens, where three columns would truncate.
 */
export function FigureRow({ children }: { children: React.ReactNode }) {
  return (
    <Card className="min-w-0">
      <CardContent className="app-figure-grid grid grid-cols-2 divide-x divide-y overflow-hidden p-0 @3xl/dashboard:auto-cols-fr @3xl/dashboard:grid-flow-col @3xl/dashboard:grid-cols-none @3xl/dashboard:divide-y-0">
        {children}
      </CardContent>
    </Card>
  );
}

/** One cell of a FigureRow. `tone` only ever carries a capacity signal. */
export function Figure({
  label,
  /** `null` renders the loading state. */
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | null;
  hint?: React.ReactNode;
  tone?: "deficit" | "surplus";
}) {
  return (
    <div className="min-w-0 px-4 py-3">
      <p className="text-xs leading-5 text-muted-foreground">{label}</p>
      {value === null ? (
        <Skeleton className="mt-1.5 h-6 w-16" />
      ) : (
        <p
          className={cn(
            "mt-1 text-2xl font-semibold leading-none tabular-nums",
            tone === "deficit" && "text-deficit",
            tone === "surplus" && "text-surplus",
          )}
        >
          {value}
        </p>
      )}
      {hint && <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** One headline figure in a framed card: the label rides on the frame. */
export function StatCard({
  icon: Icon,
  label,
  /** `null` renders the loading state. */
  value,
  hint,
  tone,
  children,
  className,
}: {
  icon?: React.ElementType;
  label: string;
  value: React.ReactNode | null;
  hint?: React.ReactNode;
  tone?: "deficit" | "surplus";
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card data-slot="stat-card" className={cn("min-w-0", className)}>
      <CardHeader className="flex items-center gap-2">
        {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
        {/* Wraps rather than truncates: two stat cards share a 360px row. */}
        <p className="min-w-0 text-xs leading-tight font-medium text-pretty text-muted-foreground">{label}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 px-4 py-3">
        {value === null ? (
          <Skeleton className="h-7 w-20" />
        ) : (
          <p
            className={cn(
              "text-[1.375rem] leading-tight font-semibold tracking-tight tabular-nums",
              tone === "deficit" && "text-deficit",
              tone === "surplus" && "text-surplus",
            )}
          >
            {value}
          </p>
        )}
        {hint && <p className="text-xs leading-snug text-pretty text-muted-foreground tabular-nums">{hint}</p>}
        {children}
      </CardContent>
    </Card>
  );
}

/** A task's category, drawn as a highlighter tab. */
export function CategoryTag({
  category,
  className,
}: {
  category: Category;
  className?: string;
}) {
  const config = CATEGORY_CONFIG[category];
  return (
    <span
      data-slot="category-tag"
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs font-medium",
        config.bg,
        config.color,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", config.dot)} aria-hidden />
      {config.label}
    </span>
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
        "flex flex-col items-center gap-4 rounded-xl px-5 py-10 text-center",
        className,
      )}
    >
      {Icon && (
        <span className="flex size-12 items-center justify-center rounded-xl border bg-frame text-foreground shadow-xs">
          <Icon className="size-6" aria-hidden />
        </span>
      )}
      <div>
        <p className="text-sm font-medium">{title}</p>
        {children && (
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{children}</p>
        )}
      </div>
      {action}
    </div>
  );
}
