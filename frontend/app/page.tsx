import type { CSSProperties } from "react";
import Link from "next/link";
import { Calendar, BarChart3, BookOpen, Check } from "@/components/icons";
import { BrandIcon } from "@/components/brand-icon";
import { CapacityBar } from "@/components/capacity-bar";
import { WeekLoad } from "@/components/week-load";
import { WeekGrid } from "@/components/week-grid";
import { NavAuth } from "@/components/landing/nav-auth";
import { ProductPreview } from "@/components/landing/product-preview";
import { demoCapacity, demoColumns, demoBlocks, demoDays, demoTasks } from "@/components/landing/demo-data";

const PLANS = [
  {
    name: "Free",
    tagline: "Everything you need to plan a term.",
    price: "$0",
    period: "forever",
    note: "No card needed.",
    features: [
      "Unlimited tasks and deadlines",
      "Weekly study hours and blocked days",
      "Automatic study schedule",
      "Warnings when a week doesn’t fit",
      "Progress on every task",
    ],
    cta: "Start for free",
    href: "/register",
    highlighted: false,
    badge: null,
  },
  {
    name: "Pro",
    tagline: "For a heavier term.",
    price: "$2.50",
    period: "per month",
    note: "Or $24 a year, two months free.",
    features: [
      "Everything in Free",
      "Sync sessions to Google Calendar",
      "End-of-term reports as PDF",
      "Compare past terms",
      "Priority email support",
    ],
    cta: "Start free, upgrade later",
    href: "/register",
    highlighted: true,
    badge: "Coming soon",
  },
];

function Navigation() {
  return (
    <nav className="absolute top-0 left-0 right-0 z-50 w-full">
      <div className="max-w-[1200px] mx-auto px-4 md:px-6 flex items-center justify-between h-16">
        {/* Logo */}
        <Link href="/" aria-label="StudyFlow home" className="flex items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
          <BrandIcon className="size-8 text-white" />
          <span className="font-[family-name:var(--font-display)] font-bold text-[16px] tracking-[-0.01em] text-white">
            StudyFlow
          </span>
        </Link>

        {/* Center nav */}
        <div className="hidden md:flex items-center gap-8">
          <Link href="#features" className="text-[14px] font-medium tracking-[-0.01em] text-white/90 hover:text-white transition-colors">
            How it works
          </Link>
          <Link href="#pricing" className="text-[14px] font-medium tracking-[-0.01em] text-white/90 hover:text-white transition-colors">
            Pricing
          </Link>
        </div>

        <NavAuth />
      </div>
    </nav>
  );
}

export default function LandingPage() {
  return (
    <div className="landing-page min-h-screen">
      <div className="landing-surface p-2 md:p-3">
        <section
          className="relative flex min-h-[720px] flex-col items-center overflow-hidden rounded-[20px] md:min-h-[800px] md:rounded-[28px]"
          style={{ background: "var(--landing-hero)" }}
        >
          <Navigation />
          <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 pb-12 pt-32 text-center md:pt-36">
            <h1 className="landing-rise mb-6 max-w-[700px] text-balance font-[family-name:var(--font-display)] text-[52px] font-bold leading-[0.95] tracking-[-0.04em] text-white md:text-[72px] lg:text-[80px]">
              Know if your week fits
            </h1>
            <p className="landing-rise mb-8 max-w-[600px] font-[family-name:var(--font-display)] text-[16px] leading-[1.5] tracking-[-0.01em] text-white/90 md:text-[18px]" style={{ "--landing-delay": "120ms" } as CSSProperties}>
              Add your coursework and the hours you’re free. StudyFlow tells you how many hours short you are, weeks before anything is due.
            </p>
            <div className="landing-rise flex flex-wrap items-center justify-center gap-x-6 gap-y-4" style={{ "--landing-delay": "240ms" } as CSSProperties}>
              <Link href="/register" className="landing-ink-button rounded-full px-8 py-3.5 text-[15px] font-semibold tracking-[-0.01em] transition-colors">
                Sign up for free
              </Link>
              <Link href="#features" className="rounded-md text-[15px] font-medium text-white underline-offset-4 hover:underline">
                See how it works
              </Link>
            </div>
          </div>
          <div className="landing-rise landing-surface landing-card-shadow relative mx-4 w-[calc(100%-2rem)] max-w-[680px] rounded-t-[24px] p-3 pb-0" style={{ "--landing-delay": "360ms" } as CSSProperties}>
            <ProductPreview label="This week: 18 hours of coursework, 14 hours available, 4 hours short. Start the essay on Tuesday to catch up.">
              <div className="space-y-5 p-5 md:p-7">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-sm font-semibold">This week</h2>
                  <span className="text-xs text-muted-foreground">28 Sep to 4 Oct</span>
                </div>
                <CapacityBar {...demoCapacity} />
                <p className="text-sm text-muted-foreground"><strong className="font-semibold text-deficit">4h short this week.</strong> Start the essay on Tuesday to catch up.</p>
              </div>
            </ProductPreview>
          </div>
        </section>
      </div>

      <section id="features" className="landing-canvas py-20 md:py-28">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="landing-reveal mx-auto mb-16 max-w-[680px] text-center md:mb-24">
            <h2 className="mb-6 font-[family-name:var(--font-display)] text-[36px] font-semibold leading-[1.1] tracking-[-0.04em] md:text-[44px]">
              Stop finding out the night before
            </h2>
            <p className="landing-muted text-[16px] leading-[1.6] md:text-[18px]">
              Add your free hours and your coursework. StudyFlow checks if it all fits, and tells you weeks ahead when it doesn’t.
            </p>
          </div>

          <div className="space-y-16 md:space-y-24">
            <div className="landing-reveal grid items-center gap-8 lg:grid-cols-2 lg:gap-16">
              <div className="min-w-0">
                <span className="landing-ink-border-soft mb-5 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium"><Calendar className="landing-accent size-3.5" />Hours</span>
                <h3 className="mb-4 font-[family-name:var(--font-display)] text-[28px] font-semibold leading-[1.15] tracking-[-0.04em] md:text-[32px]">Tell it when you’re free</h3>
                <p className="landing-muted text-[16px] leading-[1.6]">Set the hours you can study each week. Block out shifts, trips and exam days, and StudyFlow works around them.</p>
              </div>
              <ProductPreview label="Free hours for Monday to Friday, with Wednesday blocked for a midterm and two study sessions.">
                <div className="p-3 md:p-4">
                  <p className="mb-3 text-xs font-medium text-muted-foreground">28 September to 2 October</p>
                  <div className="landing-week-grid">
                    <WeekGrid columns={demoColumns} blocks={demoBlocks} hourStart={9} hourEnd={17} />
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">Free hours in green. Wednesday is blocked for your midterm.</p>
                </div>
              </ProductPreview>
            </div>

            <div className="landing-reveal grid items-center gap-8 lg:grid-cols-2 lg:gap-16">
              <div className="min-w-0 lg:col-start-2 lg:row-start-1">
                <span className="landing-ink-border-soft mb-5 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium"><BookOpen className="landing-accent size-3.5" />Tasks</span>
                <h3 className="mb-4 font-[family-name:var(--font-display)] text-[28px] font-semibold leading-[1.15] tracking-[-0.04em] md:text-[32px]">Add your coursework</h3>
                <p className="landing-muted text-[16px] leading-[1.6]">Give each task a due date and a rough estimate. StudyFlow spreads the hours across your week and shows which days are packed.</p>
              </div>
              <div className="min-w-0 lg:col-start-1 lg:row-start-1">
                <ProductPreview label="Four tasks due this week totalling 18 hours, with daily workload and deadlines.">
                  <div className="p-4 md:p-6">
                    <h4 className="mb-3 text-sm font-semibold">Due this week</h4>
                    <ul className="mb-5 divide-y divide-border">
                      {demoTasks.map((task) => (
                        <li key={task.name} className="flex items-start justify-between gap-3 py-3 text-xs">
                          <div className="min-w-0"><p className="font-medium">{task.name}</p><p className="mt-1 text-muted-foreground">{task.course} · Due {task.due}</p></div>
                          <span className="shrink-0 font-[family-name:var(--font-data)] tabular-nums">{task.estimate}</span>
                        </li>
                      ))}
                    </ul>
                    <WeekLoad days={demoDays} />
                  </div>
                </ProductPreview>
              </div>
            </div>

            <div className="landing-reveal grid items-center gap-8 lg:grid-cols-2 lg:gap-16">
              <div className="min-w-0">
                <span className="landing-ink-border-soft mb-5 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium"><BarChart3 className="landing-accent size-3.5" />Fit</span>
                <h3 className="mb-4 font-[family-name:var(--font-display)] text-[28px] font-semibold leading-[1.15] tracking-[-0.04em] md:text-[32px]">Find the hours you’re short</h3>
                <p className="landing-muted text-[16px] leading-[1.6]">StudyFlow compares the hours you need with the hours you have. If you’re 4 hours short this week, you’ll know on Monday, not Friday night.</p>
              </div>
              <ProductPreview label="This week: 18 hours of work against 14 hours of study time, with 4 hours short. Your Linear Algebra problem set needs 3 more hours than you have before Friday.">
                <div className="space-y-6 p-5 md:p-7">
                  <div><p className="mb-2 text-xs text-muted-foreground">This week</p><p className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight text-deficit">4h short</p></div>
                  <CapacityBar {...demoCapacity} />
                  <p className="border-t border-border pt-4 text-sm leading-relaxed text-muted-foreground">Your Linear Algebra problem set needs 3 more hours than you have before Friday.</p>
                </div>
              </ProductPreview>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════ Pricing ═══════ */}
      <section id="pricing" className="landing-surface py-28 scroll-mt-20">
        <div className="max-w-[960px] mx-auto px-6">
          <div className="text-center mb-14">
            <h2 className="landing-reveal font-[family-name:var(--font-display)] text-[36px] md:text-[44px] font-semibold tracking-[-0.04em] landing-ink leading-[1.1] mb-4">
              Pricing
            </h2>
            <p className="text-[16px] md:text-[18px] landing-muted leading-[1.5] tracking-[-0.01em] max-w-[520px] mx-auto">
              Planning your term is free. Pro adds calendar sync and reports when it launches.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`landing-reveal relative flex flex-col landing-surface landing-card-shadow rounded-[18px] border p-8 md:p-10 ${
                  plan.highlighted ? "border-2 border-[var(--landing-accent)]" : "landing-border"
                }`}
              >
                {plan.badge && (
                  <span className="absolute -top-3 left-8 rounded-full landing-ink-button px-3 py-1 text-[12px] font-semibold tracking-[-0.01em]">
                    {plan.badge}
                  </span>
                )}
                <h3 className="font-[family-name:var(--font-display)] text-[20px] font-semibold tracking-[-0.01em] landing-ink">
                  {plan.name}
                </h3>
                <p className="mt-1 text-[14px] landing-muted leading-[1.5]">{plan.tagline}</p>

                <p className="mt-6 flex items-baseline gap-1.5">
                  <span className="font-[family-name:var(--font-display)] text-[44px] font-semibold tracking-[-0.04em] landing-ink leading-none">
                    {plan.price}
                  </span>
                  <span className="text-[14px] landing-muted">{plan.period}</span>
                </p>
                <p className="mt-2 min-h-[21px] text-[14px] landing-muted">{plan.note}</p>

                <ul className="mt-8 mb-10 space-y-3" aria-label={`${plan.name} plan includes`}>
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5 text-[14px] landing-ink leading-[1.5]">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 landing-accent" aria-hidden="true" />
                      {feature}
                    </li>
                  ))}
                </ul>

                <Link
                  href={plan.href}
                  className={`mt-auto block rounded-full px-6 py-3 text-center text-[15px] font-semibold tracking-[-0.01em] transition-all duration-300 ${
                    plan.highlighted ? "landing-ink-button" : "border landing-ink-border landing-ink hover:bg-[var(--landing-canvas)]"
                  }`}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ CTA Banner ═══════ */}
      <section className="landing-reveal landing-surface py-28">
        <div className="max-w-[700px] mx-auto px-6 text-center">
          <h2 className="font-[family-name:var(--font-display)] text-[36px] md:text-[44px] font-semibold tracking-[-0.04em] landing-ink leading-[1.1] mb-6">
            Plan your first week
          </h2>
          <p className="text-[16px] md:text-[18px] landing-muted leading-[1.5] tracking-[-0.01em] mb-10 max-w-[480px] mx-auto">
            It takes about five minutes to add your coursework and the hours you’re free.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link href="/register" className="landing-ink-button px-8 py-3.5 rounded-full text-[16px] font-semibold tracking-[-0.01em] transition-all duration-300">
              Get started for free
            </Link>
          </div>
        </div>
      </section>

      {/* ═══════ Footer ═══════ */}
      <footer className="landing-surface border-t landing-border py-16">
        <div className="max-w-[1200px] mx-auto px-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
          <Link href="/" aria-label="StudyFlow home" className="flex items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
            <BrandIcon className="size-8" />
            <span className="font-[family-name:var(--font-display)] font-bold text-[16px] tracking-[-0.01em] landing-ink">
              StudyFlow
            </span>
          </Link>

          <div className="flex flex-wrap gap-8">
            <Link href="#features" className="text-[14px] landing-muted hover:text-[var(--landing-ink)] transition-colors">How it works</Link>
            <Link href="#pricing" className="text-[14px] landing-muted hover:text-[var(--landing-ink)] transition-colors">Pricing</Link>
            <Link href="/privacy" className="text-[14px] landing-muted hover:text-[var(--landing-ink)] transition-colors">Privacy</Link>
            <Link href="/terms" className="text-[14px] landing-muted hover:text-[var(--landing-ink)] transition-colors">Terms</Link>
          </div>

          <p className="text-[12px] landing-subtle">© 2026 StudyFlow</p>
        </div>
      </footer>
    </div>
  );
}
