import Link from "next/link";
import { GraduationCap } from "lucide-react";

/**
 * The shell every sign-in, sign-up and recovery screen sits in.
 *
 * It used to be a two-column split with a dark marketing panel down the left:
 * a headline, a paragraph and three feature bullets, all repeating what the
 * landing page already says to someone who has plainly already decided to use
 * the product. It pushed the form — the only thing on the page anybody came
 * for — into a narrow column on the right.
 *
 * Now the form is centred and alone, on the same sky the landing page opens
 * with, so arriving here feels like the same product rather than a different
 * site. The gradient, the outer padding and the rounded corners are lifted
 * from that hero deliberately.
 */
const SKY = "linear-gradient(180deg, #779bc1 0%, #9abfda 48%, #cbdcec 80%, #e4ecf3 100%)";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-svh bg-white p-2 md:p-3">
      <div
        className="relative flex min-h-[calc(100svh-1rem)] flex-col items-center justify-center overflow-hidden rounded-[20px] px-4 py-10 md:min-h-[calc(100svh-1.5rem)] md:rounded-[28px]"
        style={{ background: SKY }}
      >
        {/* Static, not animated: this is a backdrop for a form, and a moving
            one would pull the eye away from the field being filled in. */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {Array.from({ length: 15 }).map((_, i) => (
            <span
              key={i}
              className="absolute size-1 rounded-full bg-white/30"
              style={{ left: `${5 + i * 6.3}%`, top: `${10 + ((i * 17) % 75)}%` }}
            />
          ))}
        </div>

        <div className="relative z-10 flex w-full max-w-sm flex-col items-center">
          <Link
            href="/"
            className="mb-6 flex items-center gap-2.5 rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
          >
            <span className="flex size-8 items-center justify-center rounded-lg bg-white/20 backdrop-blur-sm">
              <GraduationCap className="size-5 text-white" />
            </span>
            <span className="font-display text-lg font-bold tracking-tight text-white">
              StudyFlow
            </span>
          </Link>

          <div className="w-full rounded-2xl bg-white p-6 shadow-[rgba(16,55,132,0.10)_0px_10px_40px_0px] sm:p-8">
            {children}
          </div>

          <p className="mt-6 text-xs text-white/70">© 2026 StudyFlow. Built for students.</p>
        </div>
      </div>
    </div>
  );
}
