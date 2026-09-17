"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, auth } from "@/lib/api";
import {
  notifyStudyFlowSessionInvalidated,
  subscribeToStudyFlowSessionInvalidation,
} from "@/lib/data-events";

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
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [account, setAccountState] = useState<SessionAccount | null>(null);
  const sessionRequestGeneration = useRef(0);

  useEffect(() => {
    const invalidate = () => {
      sessionRequestGeneration.current += 1;
      setAccountState(null);
      setStatus("unauthenticated");
    };
    return subscribeToStudyFlowSessionInvalidation(invalidate);
  }, []);

  // Read the session once on mount. State is only written from the promise
  // callbacks, and `active` drops results that land after unmount — React
  // Strict Mode mounts effects twice in development.
  useEffect(() => {
    let active = true;
    const generation = sessionRequestGeneration.current;
    auth
      .getSession()
      .then(({ account: current }) => {
        if (!active || generation !== sessionRequestGeneration.current) return;
        setAccountState({ ...current, avatarUrl: current.avatar_url });
        setStatus("authenticated");
      })
      .catch(() => {
        // 401 is the normal signed-out answer, not a failure worth surfacing.
        if (!active || generation !== sessionRequestGeneration.current) return;
        setAccountState(null);
        setStatus("unauthenticated");
      });
    return () => {
      active = false;
    };
  }, []);

  /** Called from event handlers — never synchronously from an effect. */
  const refresh = useCallback(async () => {
    const generation = sessionRequestGeneration.current;
    try {
      const { account: current } = await auth.getSession();
      if (generation !== sessionRequestGeneration.current) return;
      setAccountState({ ...current, avatarUrl: current.avatar_url });
      setStatus("authenticated");
    } catch (error) {
      if (generation !== sessionRequestGeneration.current) return;
      if (error instanceof ApiError && error.isUnauthenticated) {
        setAccountState(null);
        setStatus("unauthenticated");
        return;
      }
      throw error;
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await auth.logout();
    } finally {
      notifyStudyFlowSessionInvalidated();
      setAccountState(null);
      setStatus("unauthenticated");
      router.replace("/login");
    }
  }, [router]);

  const value = useMemo<SessionContextValue>(
    () => ({ status, account, refresh, setAccount: setAccountState, signOut }),
    [status, account, refresh, signOut],
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
