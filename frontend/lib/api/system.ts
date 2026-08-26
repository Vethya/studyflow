/** Service health endpoints — `backend/src/studyflow/api/{health,readiness}.py`. */

import { apiJson } from "./client";

export interface HealthReport {
  service: string;
  status: "ok";
  version: string;
}

export interface ReadinessReport {
  service: string;
  status: "ready";
  database: "reachable";
}

/** Liveness only: answers as long as the process is up. */
export function getHealth(signal?: AbortSignal): Promise<HealthReport> {
  return apiJson<HealthReport>("/health", { signal });
}

/**
 * Readiness, including the database connection. Answers 503 when a dependency
 * is down, which surfaces as an `ApiError` rather than a resolved report.
 */
export function getReadiness(signal?: AbortSignal): Promise<ReadinessReport> {
  return apiJson<ReadinessReport>("/ready", { signal });
}
