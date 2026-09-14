import { cn } from "@/lib/utils";

/**
 * A validation message tied to one form field. Give the input
 * `aria-invalid` and `aria-describedby={id}` so screen readers announce it
 * with the field (FR-01-AC02, SPEC §19.5).
 */
export function FieldError({
  id,
  message,
  className,
}: {
  id: string;
  message?: string | null;
  className?: string;
}) {
  if (!message) return null;
  return (
    <p id={id} className={cn("text-[11px] font-medium text-destructive", className)}>
      {message}
    </p>
  );
}
