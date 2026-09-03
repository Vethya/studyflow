import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        // `border` is explicit: Tailwind's preflight zeroes border-width, and
        // relying on the background alone made every field invisible as soon
        // as it sat on a white card rather than the grey page.
        "input h-8 w-full min-w-0 border border-input bg-card px-2.5 text-sm placeholder:text-muted-foreground focus:outline-2 focus:outline-offset-2 focus:outline-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:outline-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
