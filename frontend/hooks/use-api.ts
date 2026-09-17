"use client";

import { useCallback, useEffect } from "react";
import useSWR, { unstable_serialize, type Key } from "swr";
import { ApiError } from "@/lib/api";

const activeRequests = new Map<string, AbortController>();
const mountedConsumers = new Map<string, number>();

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
 * cached value and in-flight request. The loader still receives an AbortSignal
 * so API modules keep their existing typed request signatures.
 */
export function useApi<T>(
  key: Key,
  loader: (signal: AbortSignal) => Promise<T>,
): AsyncResource<T> {
  const serializedKey = unstable_serialize(key);
  const fetcher = useCallback(() => {
    activeRequests.get(serializedKey)?.abort();
    const controller = new AbortController();
    activeRequests.set(serializedKey, controller);
    return loader(controller.signal).finally(() => {
      if (activeRequests.get(serializedKey) === controller) activeRequests.delete(serializedKey);
    });
  }, [loader, serializedKey]);
  const { data, error, isLoading, isValidating, mutate } = useSWR<T>(key, fetcher);

  useEffect(() => {
    if (!serializedKey) return;
    mountedConsumers.set(serializedKey, (mountedConsumers.get(serializedKey) ?? 0) + 1);
    return () => {
      const remaining = (mountedConsumers.get(serializedKey) ?? 1) - 1;
      if (remaining <= 0) {
        mountedConsumers.delete(serializedKey);
        activeRequests.get(serializedKey)?.abort();
      } else {
        mountedConsumers.set(serializedKey, remaining);
      }
    };
  }, [serializedKey]);

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
