/** Effort progress endpoint — `backend/src/studyflow/api/progress.py`. */

import { apiJson } from "./client";
import { toEffortProgress } from "./mappers";
import type { WireEffortProgress } from "./wire";
import type { EffortProgress } from "@/types/progress";

/**
 * Server-calculated effort progress for every task on the account (SPEC §13).
 *
 * Remaining work comes from the backend because it accounts for Delayed
 * remaining minutes and outcomes on invalidated sessions, which the browser
 * cannot see from the accepted session list alone.
 */
export async function listEffortProgress(signal?: AbortSignal): Promise<EffortProgress[]> {
  const wire = await apiJson<WireEffortProgress[]>("/progress", { signal });
  return wire.map(toEffortProgress);
}
