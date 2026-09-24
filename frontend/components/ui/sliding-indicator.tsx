"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SlidingIndicatorState {
  top: number;
  left: number;
  width: number;
  height: number;
  ready: boolean;
}

export interface UseSlidingIndicatorOptions {
  activeKey?: unknown;
  activeSelector?: string;
}

export function useSlidingIndicator<T extends HTMLElement = HTMLElement>(
  options: UseSlidingIndicatorOptions = {},
) {
  const { activeKey, activeSelector } = options;
  const [containerEl, setContainerEl] = React.useState<T | null>(null);
  const [indicator, setIndicator] = React.useState<SlidingIndicatorState>({
    top: 0,
    left: 0,
    width: 0,
    height: 0,
    ready: false,
  });

  React.useLayoutEffect(() => {
    if (!containerEl) return;

    const updateIndicator = () => {
      const selector =
        activeSelector ??
        "[data-active='true'], [data-active], [aria-current='page']";
      const activeEl = containerEl.querySelector<HTMLElement>(selector);

      if (activeEl) {
        const containerRect = containerEl.getBoundingClientRect();
        const activeRect = activeEl.getBoundingClientRect();
        setIndicator({
          top: activeRect.top - containerRect.top + containerEl.scrollTop,
          left: activeRect.left - containerRect.left + containerEl.scrollLeft,
          width: activeRect.width,
          height: activeRect.height,
          ready: true,
        });
      } else {
        setIndicator((prev) => (prev.ready ? { ...prev, ready: false } : prev));
      }
    };

    updateIndicator();

    const observer = new ResizeObserver(updateIndicator);
    observer.observe(containerEl);
    containerEl.addEventListener("scroll", updateIndicator, { passive: true });

    return () => {
      observer.disconnect();
      containerEl.removeEventListener("scroll", updateIndicator);
    };
  }, [activeKey, activeSelector, containerEl]);

  return {
    containerRef: setContainerEl,
    indicator,
  };
}

export function SlidingIndicator({
  indicator,
  className,
}: {
  indicator: SlidingIndicatorState;
  className?: string;
}) {
  if (!indicator.ready) return null;

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute left-0 top-0 z-0 rounded-lg bg-sidebar-accent transition-[transform,width,height,opacity] duration-250 ease-[cubic-bezier(0.2,0,0,1)]",
        className,
      )}
      style={{
        transform: `translate3d(${indicator.left}px, ${indicator.top}px, 0)`,
        width: `${indicator.width}px`,
        height: `${indicator.height}px`,
      }}
    />
  );
}
