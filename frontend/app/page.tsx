import type { CSSProperties } from "react";
import Link from "next/link";
import Image from "next/image";
import { Calendar, BarChart3, Clock, Sparkles, Target, Check } from "@/components/icons";
import { BrandIcon } from "@/components/brand-icon";
import { CapacityBar } from "@/components/capacity-bar";
import { NavAuth } from "@/components/landing/nav-auth";
import { ProductPreview } from "@/components/landing/product-preview";
import { demoCapacity } from "@/components/landing/demo-data";

const PLANS = [
  {
    name: "Free",
    tagline: "The full planner, for every student.",
    price: "$0",
    period: "forever",
    note: "No card needed.",
    features: [
      "Unlimited tasks and deadlines",
      "Weekly availability and blocked days",
      "Automatic study schedule",
      "Overload warnings before you fall behind",
      "Effort progress for every task",
    ],
    cta: "Get started for free",
    href: "/register",
    highlighted: false,
    badge: null,
  },
  {
    name: "Pro",
    tagline: "More insight for a heavier term.",
    price: "$2.50",
    period: "per month",
    note: "Or $24 a year — two months free.",
    features: [
      "Everything in Free",
      "Sync sessions to Google Calendar",
      "End-of-term reports you can export as PDF",
      "Keep past terms to compare your workload",
      "Priority email support",
    ],
    cta: "Start with Free, upgrade later",
    href: "/register",
    highlighted: true,
    badge: "Coming soon",
  },
];

/* ─── Navigation (transparent over gradient) ─── */
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
            Features
          </Link>
          <Link href="#how-it-works" className="text-[14px] font-medium tracking-[-0.01em] text-white/90 hover:text-white transition-colors">
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

/* ─── Main Page ─── */
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

      {/* ═══════ Section Heading ═══════ */}
      <section className="landing-canvas pt-28 pb-8">
        <div className="max-w-[1200px] mx-auto px-6 text-center">
          <h2 className="landing-reveal font-[family-name:var(--font-display)] text-[36px] md:text-[44px] font-semibold tracking-[-0.04em] landing-ink leading-[1.1]">
Most students find out too late
          </h2>
        </div>
      </section>

      {/* ═══════ Feature Cards (2-column) ═══════ */}
      <section id="features" className="landing-canvas py-16">
        <div className="feature-grid max-w-[1200px] mx-auto px-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Card 1: Scheduling */}
          <div className="feature-card landing-surface landing-card-shadow rounded-[18px] border landing-border p-10 md:p-12 transition-shadow duration-500">
            <div className="flex items-center gap-2 mb-6">
              <div className="px-3 py-1 rounded-full border landing-ink-border text-[12px] font-medium tracking-[-0.01em] landing-ink flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 landing-accent" />
                Schedule
              </div>
            </div>
            <h3 className="font-[family-name:var(--font-display)] text-[24px] md:text-[28px] font-semibold tracking-[-0.04em] landing-ink leading-[1.2] mb-4">
Your real hours, not an ideal week.
            </h3>
            <p className="text-[16px] landing-muted leading-[1.5] tracking-[-0.01em] mb-8">
Set the weekly windows you are genuinely free to study, then block out the trips, shifts and exam days that take them back. That, minus the interruptions, is your capacity.
            </p>
            <div className="feature-img rounded-[12px] overflow-hidden border landing-border">
              <Image
                src="/landing/feature-calendar.png"
                alt="Schedule interface"
                width={600}
                height={400}
                className="w-full h-auto"
              />
            </div>
          </div>

          {/* Card 2: Progress */}
          <div className="feature-card landing-surface landing-card-shadow rounded-[18px] border landing-border p-10 md:p-12 transition-shadow duration-500">
            <div className="flex items-center gap-2 mb-6">
              <div className="px-3 py-1 rounded-full border landing-ink-border text-[12px] font-medium tracking-[-0.01em] landing-ink flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5 landing-accent" />
                Progress
              </div>
            </div>
            <h3 className="font-[family-name:var(--font-display)] text-[24px] md:text-[28px] font-semibold tracking-[-0.04em] landing-ink leading-[1.2] mb-4">
Every deadline, weighed in hours.
            </h3>
            <p className="text-[16px] landing-muted leading-[1.5] tracking-[-0.01em] mb-8">
Each task carries an estimate, a priority and a due date. Add them up across the next week and you have the other half of the sum — the hours you owe.
            </p>
            <div className="feature-img rounded-[12px] overflow-hidden border landing-border">
              <Image
                src="/landing/feature-progress.png"
                alt="Progress tracking dashboard"
                width={600}
                height={400}
                className="w-full h-auto"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ═══════ How It Works ═══════ */}
    
      <section id="how-it-works" className="landing-canvas py-28">
        <div className="max-w-[1200px] mx-auto px-6">
          <h2 className="landing-reveal font-[family-name:var(--font-display)] text-[36px] md:text-[44px] font-semibold tracking-[-0.04em] landing-ink leading-[1.1] text-center mb-16">
            How StudyFlow works
          </h2>

          <div className="steps-grid grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                icon: Target,
                step: "01",
                title: "Set your hours",
                desc: "Add the weekly windows you can study, and block out the days you cannot.",
              },
              {
                icon: Sparkles,
                step: "02",
                title: "Add your coursework",
                desc: "Every task gets a deadline and an estimate of how long it will take you.",
              },
              {
                icon: Clock,
                step: "03",
                title: "Read the balance",
                desc: "One figure: the hours you are short, or the hours you have spare. Change something while it still helps.",
              },
            ].map((item, i) => (
              <div key={i} className="landing-reveal landing-surface landing-card-shadow rounded-[18px] p-8 hover:-translate-y-1 transition-transform duration-300">
                <div className="flex items-center justify-between mb-6">
                  <div className="w-10 h-10 rounded-lg landing-canvas flex items-center justify-center">
                    <item.icon className="w-5 h-5 landing-accent" />
                  </div>
                  <span className="step-number font-[family-name:var(--font-display)] text-[48px] font-bold landing-subtle leading-none tracking-[-0.04em]">
                    {item.step}
                  </span>
                </div>
                <h3 className="font-[family-name:var(--font-display)] text-[20px] font-semibold tracking-[-0.01em] landing-ink leading-[1.3] mb-3">
                  {item.title}
                </h3>
                <p className="text-[14px] landing-muted leading-[1.5] tracking-[-0.01em]">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ Pricing ═══════ */}
      <section id="pricing" className="landing-surface py-28 scroll-mt-20">
        <div className="max-w-[960px] mx-auto px-6">
          <div className="text-center mb-14">
            <h2 className="landing-reveal font-[family-name:var(--font-display)] text-[36px] md:text-[44px] font-semibold tracking-[-0.04em] landing-ink leading-[1.1] mb-4">
              Simple pricing for students
            </h2>
            <p className="text-[16px] md:text-[18px] landing-muted leading-[1.5] tracking-[-0.01em] max-w-[520px] mx-auto">
              Everything you need to plan a term is free. Pro adds extras for students who want more.
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

      {/* ═══════ Full Width Product Image ═══════ */}
      <section className="landing-surface py-28">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="product-image landing-card-shadow rounded-[24px] overflow-hidden">
            <Image
              src="/landing/hero-study-app.png"
              alt="StudyFlow app interface"
              width={1200}
              height={600}
              className="w-full h-auto"
            />
          </div>
        </div>
      </section>

      {/* ═══════ CTA Banner ═══════ */}
      <section className="landing-reveal landing-surface py-28">
        <div className="max-w-[700px] mx-auto px-6 text-center">
          <h2 className="cta-heading font-[family-name:var(--font-display)] text-[36px] md:text-[44px] font-semibold tracking-[-0.04em] landing-ink leading-[1.1] mb-6">
Know now, not in week nine.
          </h2>
          <p className="cta-sub text-[16px] md:text-[18px] landing-muted leading-[1.5] tracking-[-0.01em] mb-10 max-w-[480px] mx-auto">
It takes about five minutes to enter a term of coursework and the hours you have for it.
          </p>
          <div className="cta-btn flex items-center justify-center gap-4">
            <Link href="/register" className="landing-ink-button px-8 py-3.5 rounded-full text-[16px] font-semibold tracking-[-0.01em] transition-all duration-300">
              Get started for free
            </Link>
          </div>
        </div>
      </section>

      {/* ═══════ Footer ═══════ */}
      <footer className="landing-surface border-t landing-border py-16">
        <div className="footer-content max-w-[1200px] mx-auto px-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
          <Link href="/" aria-label="StudyFlow home" className="flex items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
            <BrandIcon className="size-8" />
            <span className="font-[family-name:var(--font-display)] font-bold text-[16px] tracking-[-0.01em] landing-ink">
              StudyFlow
            </span>
          </Link>

          <div className="flex flex-wrap gap-8">
            <Link href="#features" className="text-[14px] landing-muted hover:text-[var(--landing-ink)] transition-colors">Features</Link>
            <Link href="#how-it-works" className="text-[14px] landing-muted hover:text-[var(--landing-ink)] transition-colors">How it works</Link>
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
