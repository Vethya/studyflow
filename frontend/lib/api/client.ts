/**
 * Thin fetch wrapper around the StudyFlow FastAPI backend.
 *
 * Authentication is a server-managed browser session (ADR 0002): the backend
 * sets an httpOnly `studyflow_session` cookie plus a JS-readable
 * `studyflow_csrf` cookie. Every mutating request must echo the CSRF cookie
 * back in an `X-CSRF-Token` header, so that is handled here rather than in
 * each caller.
 */

export const API_BASE = "/api/v1";

/** Dev cookie names; production adds the `__Host-` prefix. */
const CSRF_COOKIE_NAMES = ["__Host-studyflow_csrf", "studyflow_csrf"] as const;

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;
  readonly retryAfterSeconds: number | null;

  constructor(status: number, detail: string, retryAfterSeconds: number | null = null) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.retryAfterSeconds = retryAfterSeconds;
  }

  /** No session, or the session expired. Callers usually redirect to /login. */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  /** Stale CSRF token — the session cookie exists but the header did not match. */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  /** Validation failure: the payload did not satisfy the backend's rules. */
  get isValidation(): boolean {
    return this.status === 422;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }
}

export function readCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const jar = document.cookie.split("; ");
  for (const name of CSRF_COOKIE_NAMES) {
    const hit = jar.find((entry) => entry.startsWith(`${name}=`));
    if (hit) return decodeURIComponent(hit.slice(name.length + 1));
  }
  return null;
}

export type QueryValue = string | number | boolean | null | undefined;

export function buildQuery(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

/**
 * FastAPI returns `{ detail: string }` for handled errors and
 * `{ detail: [{ loc, msg, ... }] }` for Pydantic validation failures.
 */
async function extractDetail(response: Response): Promise<string> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return response.statusText || `Request failed with status ${response.status}`;
  }

  const detail = (body as { detail?: unknown })?.detail;
  if (typeof detail === "string") return detail;

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => (item as { msg?: unknown })?.msg)
      .filter((msg): msg is string => typeof msg === "string");
    if (messages.length > 0) return messages.join(". ");
  }

  return response.statusText || `Request failed with status ${response.status}`;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Set false for endpoints that must not carry the CSRF header (login, register). */
  csrf?: boolean;
  signal?: AbortSignal;
}

async function request(path: string, options: RequestOptions = {}): Promise<Response> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = { Accept: "application/json" };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const wantsCsrf = options.csrf ?? MUTATING_METHODS.has(method);
  if (wantsCsrf) {
    const token = readCsrfToken();
    if (token) headers["X-CSRF-Token"] = token;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    // Required: the session and CSRF cookies ride along on every call.
    credentials: "include",
    cache: "no-store",
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });

  if (!response.ok) {
    const retryAfter = response.headers.get("Retry-After");
    throw new ApiError(
      response.status,
      await extractDetail(response),
      retryAfter ? Number(retryAfter) : null,
    );
  }

  return response;
}

/** Perform a request whose response body is JSON. */
export async function apiJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await request(path, options);
  return (await response.json()) as T;
}

/** Perform a request that returns 204 No Content. */
export async function apiVoid(path: string, options: RequestOptions = {}): Promise<void> {
  await request(path, options);
}
