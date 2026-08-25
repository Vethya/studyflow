"use client";

import { useEffect, useState } from "react";

/**
 * The current time, as state rather than a `new Date()` call during render.
 *
 * Reading the clock while rendering is impure: React may render at any moment,
 * and two renders in the same commit can disagree about "now". It also breaks
 * server rendering, where the server's clock and the browser's differ.
 *
 * Holding it in state fixes both, and has a real benefit besides — "Up next"
 * and the awaiting-outcome list re-evaluate as time passes instead of staying
 * frozen at whatever the clock said when the page loaded.
 *
 * @param intervalMs how often to re-read the clock. One minute by default,
 *   which is the finest granularity anything in this product displays.
 */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
