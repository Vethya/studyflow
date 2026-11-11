import type { ReactNode } from "react";

export function ProductPreview({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="img" aria-label={label} className="landing-card-shadow min-w-0 overflow-hidden rounded-[18px] border border-border bg-card text-foreground">
      {/* Keep inert inside so it doesn't hide the label from assistive technology. */}
      <div inert>
        <div aria-hidden className="flex items-center gap-1.5 border-b border-border bg-muted/40 px-4 py-3">
          <span className="size-1.5 rounded-full bg-muted-foreground/30" />
          <span className="size-1.5 rounded-full bg-muted-foreground/30" />
          <span className="size-1.5 rounded-full bg-muted-foreground/30" />
          <span className="ml-2 text-[11px] font-medium text-muted-foreground">StudyFlow</span>
        </div>
        {children}
      </div>
    </div>
  );
}
