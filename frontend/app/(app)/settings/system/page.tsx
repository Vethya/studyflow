"use client";

import { useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { ApiError, system } from "@/lib/api";
import { describeError, useApi } from "@/hooks/use-api";

/**
 * Surfaces the backend's liveness and readiness probes. Useful when something
 * in the app is failing and it is not obvious whether the fault is the network,
 * the API, or the database behind it.
 */
export default function SystemSettingsPage() {
  const loadHealth = useCallback((signal: AbortSignal) => system.getHealth(signal), []);
  const loadReadiness = useCallback((signal: AbortSignal) => system.getReadiness(signal), []);

  const health = useApi(loadHealth);
  const readiness = useApi(loadReadiness);

  function reloadAll() {
    health.reload();
    readiness.reload();
  }

  // A 503 from /ready is a real answer — the service is up but a dependency is
  // not — so it is reported rather than treated as a failed request.
  const dependencyDown = readiness.error instanceof ApiError && readiness.error.status === 503;

  return (
    <div className="flex flex-col gap-2">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-base font-semibold">Service status</h2>
          <p className="text-sm text-muted-foreground">
            Whether the StudyFlow API and its database are responding.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={reloadAll}>
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          Check again
        </Button>
      </div>

      <Card>
        <CardContent className="space-y-5 p-6">
          <Row
            label="API"
            loading={health.isLoading}
            ok={health.data !== null && health.error === null}
            value={
              health.data
                ? `${health.data.service} · ${health.data.status}`
                : describeError(health.error)
            }
          />

          <Separator />

          <Row
            label="Version"
            loading={health.isLoading}
            neutral
            value={health.data?.version ?? "unknown"}
          />

          <Separator />

          <Row
            label="Database"
            loading={readiness.isLoading}
            ok={readiness.data !== null && readiness.error === null}
            value={
              readiness.data
                ? readiness.data.database
                : dependencyDown
                  ? "unreachable"
                  : describeError(readiness.error)
            }
          />
        </CardContent>
      </Card>

      <p className="mt-2 font-mono text-xs text-muted-foreground">
        Checks run against /api/v1/health and /api/v1/ready through this app&apos;s own
        origin, so a failure here also means the proxy to the API is down.
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  ok,
  neutral,
  loading,
}: {
  label: string;
  value: string;
  ok?: boolean;
  neutral?: boolean;
  loading: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="eyebrow">{label}</span>
      {loading ? (
        <Skeleton className="h-4 w-28" />
      ) : (
        <span className="flex items-center gap-2 font-mono text-sm">
          {!neutral && (
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                ok ? "bg-surplus" : "bg-deficit",
              )}
            />
          )}
          <span className={cn(!neutral && !ok && "text-deficit")}>{value}</span>
        </span>
      )}
    </div>
  );
}
