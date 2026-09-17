"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { PageHeader, PageShell } from "@/components/page-kit";

const MESSAGES: Record<string, { title: string; body: string }> = {
  denied: {
    title: "You cancelled the Google import",
    body: "Nothing was imported. You can start again whenever you like.",
  },
  permission: {
    title: "StudyFlow did not get the access it needs",
    body: "Google did not share every permission the import asks for. Start again and leave all the requested boxes ticked. If you use a school account, your school may block apps from reading Google Classroom or Calendar.",
  },
  unavailable: {
    title: "Google is not responding right now",
    body: "Nothing was imported. Please try again in a minute.",
  },
  "not-configured": {
    title: "Google import is not set up on this server",
    body: "Nothing was imported. Ask the StudyFlow team to finish the Google Cloud setup.",
  },
  invalid: {
    title: "The Google import could not be completed",
    body: "The request expired or was opened in a different browser. Start the import again from the same tab.",
  },
};

function ImportError() {
  const code = useSearchParams().get("error") ?? "invalid";
  const message = MESSAGES[code] ?? MESSAGES.invalid;

  return (
    <PageShell width="narrow">
      <PageHeader title="Google import" />
      <Callout
        tone={code === "denied" ? "info" : "warning"}
        title={message.title}
        actions={
          <>
            <Button size="sm" nativeButton={false} render={<Link href="/availability" />}>
              Back to Availability
            </Button>
            <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/tasks" />}>
              Back to Tasks
            </Button>
          </>
        }
      >
        {message.body}
      </Callout>
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
