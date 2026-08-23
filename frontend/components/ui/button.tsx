import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * DaisyUI supplies the look; Base UI still supplies the behaviour.
 *
 * `.btn` and its modifiers replace the hand-rolled Tailwind recipe, so every
 * button in the product inherits one set of sizing, radius and state rules.
 * The variant and size names are unchanged, so no call site has to move.
 */
const buttonVariants = cva(
  "btn group/button font-medium normal-case transition-[color,background-color,border-color] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "btn-primary",
        outline: "btn-outline border-border bg-card text-foreground hover:border-border hover:bg-muted hover:text-foreground",
        secondary: "btn-secondary",
        ghost: "btn-ghost hover:bg-muted",
        // Destructive reads as a warning, not a filled danger button: this
        // product reserves saturated fills for capacity, not for chrome.
        destructive:
          "btn-ghost bg-destructive/10 text-destructive hover:bg-destructive/20",
        link: "btn-link text-primary no-underline hover:underline",
      },
      size: {
        default: "h-8 min-h-8 gap-1.5 px-2.5 text-sm",
        xs: "h-6 min-h-6 gap-1 px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 min-h-7 gap-1 px-2.5 text-[0.8rem] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 min-h-9 gap-1.5 px-3 text-sm",
        icon: "btn-square h-8 min-h-8 w-8 p-0",
        "icon-xs": "btn-square h-6 min-h-6 w-6 p-0 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "btn-square h-7 min-h-7 w-7 p-0",
        "icon-lg": "btn-square h-9 min-h-9 w-9 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
