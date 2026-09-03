"use client";

import * as React from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

/**
 * The detail surface SPEC §17.3 calls for: a side drawer on desktop, a bottom
 * sheet on mobile. One component so the two never drift apart, and so callers
 * never have to know which one they are getting.
 *
 * The bottom sheet is capped at 85vh with its body scrolling, because a sheet
 * taller than the viewport puts its own close button off-screen on a phone.
 */
export function DetailDrawer({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
  className,
  size = "default",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  size?: "default" | "wide";
}) {
  const isMobile = useIsMobile();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        size={size}
        className={cn(
          "gap-0 p-0",
          isMobile && "max-h-[85vh] rounded-t-xl",
          className,
        )}
      >
        {/* Grabber: the affordance that says a bottom sheet can be dismissed. */}
        {isMobile && (
          <div className="flex justify-center pt-2.5" aria-hidden>
            <span className="h-1 w-9 rounded-full bg-border" />
          </div>
        )}

        <SheetHeader className="gap-1 border-b px-5 pb-4 pe-14 pt-4">
          <SheetTitle className="font-display text-base font-semibold tracking-tight">
            {title}
          </SheetTitle>
          {description && (
            <SheetDescription className="text-sm">{description}</SheetDescription>
          )}
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <SheetFooter className="flex-row flex-wrap justify-end gap-2 border-t px-5 py-3">
            {footer}
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
