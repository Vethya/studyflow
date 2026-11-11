"use client";

import * as React from "react";

type ViewTransitionProps = {
  enter?: string;
  exit?: string;
  default?: string;
  children: React.ReactNode;
};

// Next's App Router bundles a React canary that ships <ViewTransition>; the
// stable React used by unit tests does not, so fall back to a plain swap there.
const ViewTransition = (React as unknown as { ViewTransition?: React.ComponentType<ViewTransitionProps> }).ViewTransition;

/**
 * Keeps the old page on screen until the new one is ready, then crossfades.
 * Navigations are React transitions, so the browser's View Transitions API
 * animates between the two snapshots instead of flashing a blank frame.
 */
export function PageTransition({ id, children }: { id: string; children: React.ReactNode }) {
  const page = <div className="h-full">{children}</div>;
  if (!ViewTransition) return <React.Fragment key={id}>{page}</React.Fragment>;
  return (
    <ViewTransition key={id} enter="page-enter" exit="page-exit" default="none">
      {page}
    </ViewTransition>
  );
}
