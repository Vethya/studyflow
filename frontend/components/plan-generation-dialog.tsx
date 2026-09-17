"use client";

import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function PlanGenerationDialog({ open }: { open: boolean }) {
  return (
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader className="items-center text-center">
          <div
            className="flex size-12 items-center justify-center rounded-full bg-muted text-foreground"
            aria-hidden="true"
          >
            <Loader2 className="size-6 animate-spin" />
          </div>
          <DialogTitle>Building your plan</DialogTitle>
          <DialogDescription>
            StudyFlow is fitting your tasks into the time you have. Your current plan stays
            unchanged until you review and accept the result.
          </DialogDescription>
        </DialogHeader>
        <p className="text-center text-xs text-muted-foreground" role="status" aria-live="polite">
          This can take a moment.
        </p>
      </DialogContent>
    </Dialog>
  );
}
