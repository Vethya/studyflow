"use client";

import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { ApiError, auth } from "@/lib/api";
import {
  notifyStudyFlowSessionInvalidated,
  subscribeToStudyFlowSessionInvalidation,
} from "@/lib/data-events";
import { SWR_KEYS } from "@/lib/swr-keys";

export interface SessionAccount {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
}

type SessionStatus = "loading" | "authenticated" | "unauthenticated";

interface SessionContextValue {
  status: SessionStatus;
  account: SessionAccount | null;
  /** Re-reads `/auth/session`; call after anything that changes the account. */
  refresh: () => Promise<void>;
  /** Locally overwrite the cached account, e.g. after renaming the profile. */
  setAccount: (account: SessionAccount) => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { mutate: mutateAll } = useSWRConfig();
  const loadSession = useCallback(async (): Promise<SessionAccount | null> => {
    try {
      const { account: current } = await auth.getSession();
      return { ...current, avatarUrl: current.avatar_url };
    } catch (error) {
      // A missing or expired session is the normal signed-out answer.
      if (error instanceof ApiError && error.isUnauthenticated) return null;
      throw error;
    }
  }, []);
  const { data, error, isLoading, mutate } = useSWR<SessionAccount | null>(SWR_KEYS.session, loadSession, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });

  useEffect(() => {
    const invalidate = () => {
      void mutate(null, { revalidate: false });
      void mutateAll(
        (key) => key !== SWR_KEYS.session,
        undefined,
        { revalidate: false },
      );
    };
    return subscribeToStudyFlowSessionInvalidation(invalidate);
  }, [mutate, mutateAll]);

  /** Called from event handlers — never synchronously from an effect. */
  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  const signOut = useCallback(async () => {
    try {
      await auth.logout();
    } finally {
      notifyStudyFlowSessionInvalidated();
      router.replace("/login");
    }
  }, [router]);

  const account = data ?? null;
  const status: SessionStatus = isLoading
    ? "loading"
    : account
      ? "authenticated"
      : error
        ? "loading"
        : "unauthenticated";

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      account,
      refresh,
      setAccount: (next: SessionAccount) => {
        void mutate(next, { revalidate: false });
      },
      signOut,
    }),
    [account, mutate, refresh, signOut, status],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used inside a <SessionProvider>");
  }
  return context;
}
