import * as SecureStore from 'expo-secure-store';

import type { WireMobileTokenResponse } from '@studyflow/api';

const SESSION_KEY = 'studyflow-mobile-session';

export type StoredMobileSession = WireMobileTokenResponse;

export async function loadStoredSession(): Promise<StoredMobileSession | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredMobileSession;
  } catch {
    await clearStoredSession();
    return null;
  }
}

export async function saveStoredSession(session: StoredMobileSession) {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
}

export async function clearStoredSession() {
  await SecureStore.deleteItemAsync(SESSION_KEY);
}
