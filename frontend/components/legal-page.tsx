import Link from "next/link";
import { ArrowLeft, BookOpen } from "lucide-react";

export const LEGAL_LAST_UPDATED = "18 September 2026";

interface LegalPageProps {
  title: string;
  intro: string;
  children: React.ReactNode;
}

/** Shared shell for the Privacy Policy and Terms of Service pages. */
export function LegalPage({ title, intro, children }: LegalPageProps) {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex max-w-[760px] items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            Studyflow
          </Link>
          <Link
            href="/"
            className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[760px] px-4 py-12 sm:px-6 sm:py-16">
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight sm:text-4xl">
          {title}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated {LEGAL_LAST_UPDATED}</p>
        <p className="mt-6 text-base leading-7">{intro}</p>
        <div className="legal-content mt-10 space-y-10">{children}</div>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-[760px] flex-wrap gap-6 px-4 py-6 text-sm text-muted-foreground sm:px-6">
          <Link href="/privacy" className="hover:text-foreground">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-foreground">Terms of Service</Link>
          <span>© 2026 Studyflow</span>
        </div>
      </footer>
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <div className="space-y-3 text-[15px] leading-7 text-foreground/90 [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">
        {children}
      </div>
    </section>
  );
}
