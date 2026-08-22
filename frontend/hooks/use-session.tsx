"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, auth } from "@/lib/api";

export interface SessionAccount {
  id: string;
  email: string;
  name: string;
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

  // Read the session once on mount. State is only written from the promise
  // callbacks, and `active` drops results that land after unmount — React
  // Strict Mode mounts effects twice in development.
  useEffect(() => {
    let active = true;
    auth
      .getSession()
      .then(({ account: current }) => {
        if (!active) return;
        setAccountState(current);
        setStatus("authenticated");
      })
      .catch(() => {
        // 401 is the normal signed-out answer, not a failure worth surfacing.
        if (!active) return;
        setAccountState(null);
        setStatus("unauthenticated");
      });
    return () => {
      active = false;
    };
  }, []);

  /** Called from event handlers — never synchronously from an effect. */
  const refresh = useCallback(async () => {
    try {
      const { account: current } = await auth.getSession();
      setAccountState(current);
      setStatus("authenticated");
    } catch (error) {
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
