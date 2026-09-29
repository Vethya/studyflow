import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';

import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import type { WireMobileTokenResponse } from '@studyflow/api';

import { apiRequest } from '../lib/api-client';
import { clearStoredSession, loadStoredSession, saveStoredSession } from '../lib/auth-storage';

WebBrowser.maybeCompleteAuthSession();

type AuthContextValue = {
  session: WireMobileTokenResponse | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  completeGoogleLink: (challenge: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

export class GoogleAccountLinkRequiredError extends Error {
  constructor(readonly challenge: string) {
    super('Your Google account is already associated with a StudyFlow account. Enter that account password to continue.');
    this.name = 'GoogleAccountLinkRequiredError';
  }
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<WireMobileTokenResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadStoredSession()
      .then(setSession)
      .finally(() => setIsLoading(false));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isLoading,
      async signIn(email, password) {
        const next = await apiRequest<WireMobileTokenResponse>('/auth/mobile/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });
        await saveStoredSession(next);
        setSession(next);
      },
      async signInWithGoogle() {
        const started = await apiRequest<{ authorization_url: string }>('/auth/mobile/google/start', {
          method: 'POST',
          body: JSON.stringify({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
        });
        const result = await WebBrowser.openAuthSessionAsync(started.authorization_url, 'studyflow://auth/google');
        if (result.type !== 'success') throw new Error('Google sign-in was cancelled');
        const parsed = Linking.parse(result.url);
        const query = parsed.queryParams ?? {};
        const getQueryValue = (key: string) => {
          const value = query[key];
          return Array.isArray(value) ? value[0] : value;
        };
        const error = getQueryValue('error');
        if (error === 'account_link_required') {
          const challenge = getQueryValue('challenge');
          if (typeof challenge !== 'string') throw new Error('Google sign-in could not be completed');
          throw new GoogleAccountLinkRequiredError(challenge);
        }
        if (typeof error === 'string') throw new Error('Google sign-in could not be completed');
        const code = getQueryValue('code');
        if (typeof code !== 'string') throw new Error('Google sign-in did not return a valid code');
        const next = await apiRequest<WireMobileTokenResponse>('/auth/mobile/google/exchange', {
          method: 'POST',
          body: JSON.stringify({ code }),
        });
        await saveStoredSession(next);
        setSession(next);
      },
      async completeGoogleLink(challenge, password) {
        const next = await apiRequest<WireMobileTokenResponse>('/auth/mobile/google/link', {
          method: 'POST',
          body: JSON.stringify({ challenge, password }),
        });
        await saveStoredSession(next);
        setSession(next);
      },
      async signOut() {
        if (session) {
          await apiRequest<void>('/auth/mobile/logout', {
            method: 'POST',
            body: JSON.stringify({ refresh_token: session.refresh_token }),
          }).catch(() => undefined);
        }
        await clearStoredSession();
        setSession(null);
      },
    }),
    [isLoading, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
