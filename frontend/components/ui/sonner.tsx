"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme()
  const sonnerTheme = resolvedTheme === "light" ? "light" : "dark"

  return (
    <Sonner
      theme={sonnerTheme}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--success-bg": "var(--surplus-soft)",
          "--success-text": "var(--surplus)",
          "--success-border": "var(--surplus)",
          "--info-bg": "var(--muted)",
          "--info-text": "var(--foreground)",
          "--info-border": "var(--border)",
          "--warning-bg": "var(--deficit-soft)",
          "--warning-text": "var(--deficit)",
          "--warning-border": "var(--deficit)",
          "--error-bg": "var(--deficit-soft)",
          "--error-text": "var(--deficit)",
          "--error-border": "var(--deficit)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
