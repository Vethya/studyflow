"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { STUDYFLOW_DATA_CHANGED_EVENT } from "@/lib/data-events";

interface State<T> {
  data: T | null;
  error: ApiError | Error | null;
  isLoading: boolean;
}

export interface AsyncResource<T> extends State<T> {
  /** Re-runs the loader. Safe to call from event handlers. */
  reload: () => void;
  /** Replace the cached value without a round trip, e.g. after a mutation. */
  setData: (next: T) => void;
}

/**
 * Loads a value from the API on mount and whenever `loader` or `deps` change.
 *
 * The loader receives an `AbortSignal` so an in-flight request is cancelled
 * when the component unmounts or the dependencies change again. Pass a
 * `useCallback`-wrapped loader; its identity is part of the dependency list.
 */
export function useApi<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  deps: React.DependencyList = [],
): AsyncResource<T> {
  const [state, setState] = useState<State<T>>({
    data: null,
    error: null,
    isLoading: true,
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    loader(controller.signal)
      .then((value) => {
        if (active) setState({ data: value, error: null, isLoading: false });
      })
      .catch((cause: unknown) => {
        if (!active || controller.signal.aborted) return;
        setState((previous) => ({
          ...previous,
          error: cause instanceof Error ? cause : new Error(String(cause)),
          isLoading: false,
        }));
      });

    return () => {
      active = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, loader, ...deps]);

  // WebMCP mutations happen outside React event handlers. Refresh mounted
  // resources after those calls so the visible app stays in sync with the
  // authenticated session the agent just changed.
  useEffect(() => {
    const onDataChanged = () => {
      setState((previous) => ({ ...previous, error: null, isLoading: true }));
      setNonce((value) => value + 1);
    };
    window.addEventListener(STUDYFLOW_DATA_CHANGED_EVENT, onDataChanged);
    return () => window.removeEventListener(STUDYFLOW_DATA_CHANGED_EVENT, onDataChanged);
  }, []);

  const reload = useCallback(() => {
    setState((previous) => ({ ...previous, error: null, isLoading: true }));
    setNonce((value) => value + 1);
  }, []);

  const setData = useCallback((next: T) => {
    setState((previous) => ({ ...previous, data: next, error: null }));
  }, []);

  return { ...state, reload, setData };
}

/** Human-readable text for an error thrown by the API client. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}
