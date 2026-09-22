"use client";

import * as React from "react";
import { Eye } from "lucide-react";

import { Input } from "@/components/ui/input";
import styles from "./password-input.module.css";

type PasswordInputProps = Omit<React.ComponentProps<typeof Input>, "type">;

function PasswordInput({ className, disabled, ...props }: PasswordInputProps) {
  const [visible, setVisible] = React.useState(false);
  const [hasToggled, setHasToggled] = React.useState(false);

  return (
    <div className="relative w-full">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        disabled={disabled}
        className={[
          "pr-10",
          hasToggled && (visible ? styles.reveal : styles.hide),
          className,
        ].filter(Boolean).join(" ")}
      />
      <button
        type="button"
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        disabled={disabled}
        onClick={() => {
          setVisible((value) => !value);
          setHasToggled(true);
        }}
        className="absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span aria-hidden="true" className="relative size-4">
          <Eye className="absolute inset-0 size-4" />
          <svg
            className="absolute inset-0 size-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path
              d="M2 2 22 22"
              pathLength={1}
              stroke="var(--card)"
              strokeWidth="4"
              strokeDasharray="1 2"
              strokeDashoffset={visible ? 0 : 1.1}
              className="transition-[stroke-dashoffset] duration-[180ms] ease-out motion-reduce:transition-none"
            />
            <path
              d="M2 2 22 22"
              pathLength={1}
              strokeDasharray="1 2"
              strokeDashoffset={visible ? 0 : 1.1}
              className="transition-[stroke-dashoffset] duration-[180ms] ease-out motion-reduce:transition-none"
            />
          </svg>
        </span>
      </button>
    </div>
  );
}

export { PasswordInput };
