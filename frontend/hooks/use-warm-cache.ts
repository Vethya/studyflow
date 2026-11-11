"use client";

import { useEffect } from "react";
import { useSWRConfig } from "swr";
import { account, availability } from "@/lib/api";
import { SWR_KEYS } from "@/lib/swr-keys";

/**
 * The shell already loads tasks, study hours and the active plan. These are
 * the remaining reads a page needs on first open, fetched once the browser is
 * idle so the Calendar, Availability and Settings pages open with data instead
 * of skeletons.
 *
 * Results go straight into the SWR cache rather than through `preload`: SWR
 * keeps unconsumed preloads in a module-level store that signing out cannot
 * clear, so the next account to sign in would be handed the previous one's
 * profile. Anything still in flight when the account changes is discarded.
 */
const WARM: Array<[string, (signal: AbortSignal) => Promise<unknown>]> = [
  [SWR_KEYS.unavailablePeriods, (signal) => availability.listUnavailablePeriods(signal)],
  [SWR_KEYS.profile, (signal) => account.getProfile(signal)],
  [SWR_KEYS.identities, (signal) => account.getLinkedIdentities(signal)],
];

/** `accountId` is the signed-in account, or null while there is none. */
export function useWarmCache(accountId: string | null): void {
  const { cache, mutate } = useSWRConfig();
  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    const run = () => {
      for (const [key, load] of WARM) {
        if (cache.get(key)?.data !== undefined) continue;
        load(controller.signal).then(
          (data) => {
            // A page may have fetched it meanwhile; its answer is at least as fresh.
            if (controller.signal.aborted || cache.get(key)?.data !== undefined) return;
            void mutate(key, data, { revalidate: false });
          },
          // A failed warm-up is not an error: the page fetches again when opened.
          () => {},
        );
      }
    };
    let cancelSchedule: () => void;
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(run, { timeout: 2_000 });
      cancelSchedule = () => window.cancelIdleCallback(handle);
    } else {
      const timer = window.setTimeout(run, 500);
      cancelSchedule = () => window.clearTimeout(timer);
    }
    return () => {
      cancelSchedule();
      controller.abort();
    };
  }, [accountId, cache, mutate]);
}
