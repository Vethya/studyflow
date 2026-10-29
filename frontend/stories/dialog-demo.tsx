import { useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export function DialogDemo({ label, children }: {
  label: string;
  children: (open: boolean, onOpenChange: (open: boolean) => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <Button onClick={() => setOpen(true)}>{label}</Button>
    {children(open, setOpen)}
  </>;
}
