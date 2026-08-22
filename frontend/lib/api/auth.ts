/** Authentication endpoints — `backend/src/studyflow/api/auth.py`. */

import { apiJson, apiVoid, buildQuery } from "./client";
import type {
  WireAuthenticationMessage,
  WireCurrentSessionResponse,
  WireEmailVerificationResponse,
  WireLoginResponse,
  WireOIDCStartResponse,
} from "./wire";

/**
 * Registration is email-first and runs in three steps:
 *
 *   1. `register(email)`      — backend emails a single-use verification link
 *   2. `verifyEmail(token)`   — exchanges that link's token for a signup token
 *   3. `completeRegistration` — signup token + name + password + timezone
 *
 * Completing registration does not sign the user in; they log in afterwards.
 */
export function register(email: string): Promise<WireAuthenticationMessage> {
  return apiJson<WireAuthenticationMessage>("/auth/register", {
    method: "POST",
    body: { email },
    csrf: false,
  });
}

export function verifyEmail(token: string): Promise<WireEmailVerificationResponse> {
  return apiJson<WireEmailVerificationResponse>("/auth/verify-email", {
    method: "POST",
    body: { token },
    csrf: false,
  });
}

export interface CompleteRegistrationInput {
  signupToken: string;
  name: string;
  password: string;
  timezone: string;
}

export function completeRegistration(
  input: CompleteRegistrationInput,
): Promise<WireAuthenticationMessage> {
  return apiJson<WireAuthenticationMessage>("/auth/complete-registration", {
    method: "POST",
    body: {
      signup_token: input.signupToken,
      name: input.name,
      password: input.password,
      timezone: input.timezone,
    },
    csrf: false,
  });
}

export function resendVerification(email: string): Promise<WireAuthenticationMessage> {
  return apiJson<WireAuthenticationMessage>("/auth/resend-verification", {
    method: "POST",
    body: { email },
    csrf: false,
  });
}

/** Sets the session and CSRF cookies as a side effect of the response. */
export function login(email: string, password: string): Promise<WireLoginResponse> {
  return apiJson<WireLoginResponse>("/auth/login", {
    method: "POST",
    body: { email, password },
    csrf: false,
  });
}

/** Resolves with the signed-in account, or throws `ApiError` 401 when signed out. */
export function getSession(signal?: AbortSignal): Promise<WireCurrentSessionResponse> {
  return apiJson<WireCurrentSessionResponse>("/auth/session", { signal });
}

/** Idempotent: succeeds even when no session cookie is present. */
export function logout(): Promise<void> {
  return apiVoid("/auth/logout", { method: "POST" });
}

export function forgotPassword(email: string): Promise<WireAuthenticationMessage> {
  return apiJson<WireAuthenticationMessage>("/auth/forgot-password", {
    method: "POST",
    body: { email },
    csrf: false,
  });
}

export function resetPassword(
  token: string,
  password: string,
): Promise<WireAuthenticationMessage> {
  return apiJson<WireAuthenticationMessage>("/auth/reset-password", {
    method: "POST",
    body: { token, password },
    csrf: false,
  });
}

/**
 * Returns the Google authorization URL to send the browser to. The callback
 * lands back on the backend, which redirects to `/app` on success or to
 * `/login/google-link` / `/login/google-error/:reason` otherwise.
 *
 * `timezone` is required and must be a valid IANA zone: a first-time Google
 * signup has no account yet, so this is where the new account's timezone comes
 * from. Omitting it fails the request with 422.
 */
export function startGoogleSignIn(timezone: string): Promise<WireOIDCStartResponse> {
  return apiJson<WireOIDCStartResponse>(`/auth/google/start${buildQuery({ timezone })}`);
}

/**
 * Completes a Google sign-in that collided with an existing password account.
 * The link challenge is held in an httpOnly cookie set by the callback, so
 * only the password is sent.
 */
export function linkGoogleAccount(password: string): Promise<WireLoginResponse> {
  return apiJson<WireLoginResponse>("/auth/google/link/browser", {
    method: "POST",
    body: { password },
    csrf: false,
  });
}
