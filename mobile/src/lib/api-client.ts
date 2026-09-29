import Constants from 'expo-constants';

import type { WireMobileTokenResponse } from '@studyflow/api';

import {
  clearStoredSession,
  loadStoredSession,
  saveStoredSession,
  type StoredMobileSession,
} from './auth-storage';

const configuredBaseUrl = Constants.expoConfig?.extra?.apiBaseUrl;
const environmentBaseUrl = process.env.EXPO_PUBLIC_API_URL;
export const API_BASE_URL = `${configuredBaseUrl ?? environmentBaseUrl ?? 'http://localhost:8000'}/api/v1`;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let refreshPromise: Promise<StoredMobileSession | null> | null = null;

async function refreshSession(session: StoredMobileSession): Promise<StoredMobileSession | null> {
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_BASE_URL}/auth/mobile/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    })
      .then(async (response) => {
        if (!response.ok) {
          await clearStoredSession();
          return null;
        }
        const next = (await response.json()) as WireMobileTokenResponse;
        await saveStoredSession(next);
        return next;
      })
      .catch(async () => {
        await clearStoredSession();
        return null;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export async function apiRequest<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const session = await loadStoredSession();
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (session) headers.set('Authorization', `Bearer ${session.access_token}`);

  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  if (response.status === 401 && session && !retried && !path.startsWith('/auth/mobile/')) {
    const refreshed = await refreshSession(session);
    if (refreshed) return apiRequest<T>(path, init, true);
  }
  if (!response.ok) {
    let detail = `Request failed with status ${response.status}`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      // Keep the status-based message when the server has no JSON body.
    }
    throw new ApiError(detail, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
