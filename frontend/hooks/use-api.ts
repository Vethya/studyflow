"use client";

import { useCallback, useLayoutEffect, useRef } from "react";
import useSWR, { type Key } from "swr";
import { ApiError } from "@/lib/api";

export interface AsyncResource<T> extends State<T> {
  /** Re-runs the loader. Safe to call from event handlers. */
  reload: () => void;
  /** Replace the cached value without a round trip, e.g. after a mutation. */
  setData: (next: T) => void;
}

interface State<T> {
  data: T | null;
  error: ApiError | Error | null;
  isLoading: boolean;
  isValidating: boolean;
}

/**
 * Reads a server-state resource through SWR.
 *
 * The key is the identity of the resource. Components sharing a key share the
 * cached value and in-flight request. The loader receives an AbortSignal
 * for API module signature compatibility.
 */
export function useApi<T>(
  key: Key,
  loader: (signal: AbortSignal) => Promise<T>,
): AsyncResource<T> {
  const loaderRef = useRef(loader);
  // Updated before SWR's own layout effect revalidates, so fetches use the latest loader.
  useLayoutEffect(() => {
    loaderRef.current = loader;
  });

  const fetcher = useCallback(() => {
    const controller = new AbortController();
    return loaderRef.current(controller.signal);
  }, []);

  const { data, error, isLoading, isValidating, mutate } = useSWR<T>(key, fetcher);

  const reload = useCallback(() => {
    void mutate();
  }, [mutate]);

  const setData = useCallback((next: T) => {
    void mutate(next, { revalidate: false });
  }, [mutate]);

  return {
    data: data ?? null,
    error: error
      ? error instanceof Error
        ? error
        : new Error(String(error))
      : null,
    isLoading,
    isValidating,
    reload,
    setData,
  };
}

/** Human-readable text for an error thrown by the API client. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}
