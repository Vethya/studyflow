"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { CircleSlash, CloudOff, KeyRound, Settings2, TimerOff } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader, PageShell } from "@/components/page-kit";
import { StepFlow } from "@/components/study-kit";
import { cn } from "@/lib/utils";

const MESSAGES: Record<string, { title: string; body: string; icon: React.ElementType }> = {
  denied: {
    title: "You cancelled the Google import",
    body: "Nothing was imported. You can start again whenever you like.",
    icon: CircleSlash,
  },
  permission: {
    title: "StudyFlow did not get the access it needs",
    body: "Google did not share every permission the import asks for. Start again and leave all the requested boxes ticked. If you use a school account, your school may block apps from reading Google Classroom or Calendar.",
    icon: KeyRound,
  },
  unavailable: {
    title: "Google is not responding right now",
    body: "Nothing was imported. Please try again in a minute.",
    icon: CloudOff,
  },
  "not-configured": {
    title: "Google import is not set up on this server",
    body: "Nothing was imported. Ask the StudyFlow team to finish the Google Cloud setup.",
    icon: Settings2,
  },
  invalid: {
    title: "The Google import could not be completed",
    body: "The request expired or was opened in a different browser. Start the import again from the same tab.",
    icon: TimerOff,
  },
};

function ImportError() {
  const code = useSearchParams().get("error") ?? "invalid";
  const message = MESSAGES[code] ?? MESSAGES.invalid;
  const cancelled = code === "denied";
  const Icon = message.icon;

  return (
    <PageShell width="narrow">
      <StepFlow steps={["Connect Google", "Choose what to add", "Done"]} current={0} label="Import steps" />
      <PageHeader eyebrow="Google" title="Google import" />
      <Card className="rise-in">
        <CardContent className="flex flex-col items-start gap-4 @lg/dashboard:flex-row">
          <span
            aria-hidden
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-full border bg-card",
              cancelled ? "text-muted-foreground" : "border-deficit/30 text-deficit",
            )}
          >
            <Icon className="size-5" />
          </span>
          <div className="min-w-0 space-y-2" role={cancelled ? "status" : "alert"}>
            <h2 className="text-xl leading-snug font-semibold tracking-tight">{message.title}</h2>
            <p className="max-w-prose text-sm text-muted-foreground">{message.body}</p>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button size="sm" nativeButton={false} render={<Link href="/availability" />}>
                Back to Availability
              </Button>
              <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/tasks" />}>
                Back to Tasks
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </PageShell>
  );
}

export default function GoogleImportErrorPage() {
  return (
    <Suspense>
      <ImportError />
    </Suspense>
  );
}
