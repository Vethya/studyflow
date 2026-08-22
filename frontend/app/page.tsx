"use client";

import { useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Calendar, BarChart3, Clock, Sparkles, BookOpen, Target, GraduationCap, Pencil, NotebookPen } from "lucide-react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/dist/ScrollTrigger";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger, useGSAP);
}

/* ─── Floating Student Elements ─── */
function FloatingElements() {
  const elRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    if (!elRef.current) return;
    const items = elRef.current.querySelectorAll(".float-item");
    items.forEach((item) => {
      gsap.to(item, {
        y: gsap.utils.random(-25, 25),
        x: gsap.utils.random(-15, 15),
        rotation: gsap.utils.random(-10, 10),
        duration: gsap.utils.random(4, 8),
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
        delay: gsap.utils.random(0, 3),
      });
    });
    // Also animate small dots
    const dots = elRef.current.querySelectorAll(".dot");
    dots.forEach((dot) => {
      gsap.to(dot, {
        y: gsap.utils.random(-15, 15),
        opacity: gsap.utils.random(0.2, 0.7),
        duration: gsap.utils.random(3, 6),
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
        delay: gsap.utils.random(0, 3),
      });
    });
  }, { scope: elRef });

  const floatingIcons = [
    { Icon: BookOpen, left: "8%", top: "20%", size: "w-5 h-5" },
    { Icon: GraduationCap, left: "85%", top: "15%", size: "w-6 h-6" },
    { Icon: Pencil, left: "12%", top: "65%", size: "w-4 h-4" },
    { Icon: NotebookPen, left: "90%", top: "55%", size: "w-5 h-5" },
    { Icon: BookOpen, left: "25%", top: "80%", size: "w-4 h-4" },
    { Icon: GraduationCap, left: "75%", top: "75%", size: "w-4 h-4" },
  ];

  return (
    <div ref={elRef} className="absolute inset-0 pointer-events-none overflow-hidden">
      {/* Floating student icons */}
      {floatingIcons.map((item, i) => (
        <div
          key={`icon-${i}`}
          className={`float-item absolute ${item.size} text-white/15`}
          style={{ left: item.left, top: item.top }}
        >
          <item.Icon className="w-full h-full" />
        </div>
      ))}
      {/* Small dots */}
      {Array.from({ length: 15 }).map((_, i) => (
        <div
          key={`dot-${i}`}
          className="dot absolute w-1 h-1 rounded-full bg-white/30"
          style={{
            left: `${5 + (i * 6.3)}%`,
            top: `${10 + ((i * 17) % 75)}%`,
          }}
        />
      ))}
    </div>
  );
}

/* ─── Navigation (transparent over gradient) ─── */
function Navigation() {
  const navRef = useRef(null);

  useGSAP(() => {
    gsap.from(navRef.current, {
      y: -20,
      opacity: 0,
      duration: 0.8,
      ease: "power2.out",
      delay: 0.1,
    });
  }, { scope: navRef });

  return (
    <nav ref={navRef} className="absolute top-0 left-0 right-0 z-50 w-full">
      <div className="max-w-[1200px] mx-auto px-6 flex items-center justify-between h-16">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-white/20 backdrop-blur-sm flex items-center justify-center">
            <BookOpen className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="font-[family-name:var(--font-display)] font-bold text-[16px] tracking-[-0.01em] text-white">
            Studyflow
          </span>
        </div>

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

        {/* Right auth */}
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-[14px] font-medium tracking-[-0.01em] text-white hover:text-white/80 transition-colors">
            Login
          </Link>
          <Link href="/register">
            <button className="px-5 py-2 rounded-full bg-white text-[#070709] text-[14px] font-medium tracking-[-0.01em] hover:bg-white/90 transition-colors shadow-[rgba(36,36,40,0.1)_0px_1px_2px_0px]">
              Sign up
            </button>
          </Link>
        </div>
      </div>
    </nav>
  );
}

/* ─── Main Page ─── */
export default function LandingPage() {
  const container = useRef(null);

  useGSAP(() => {
    // ═══ HERO ANIMATIONS ═══
    // Cards show immediately — no waiting
    gsap.set(".hero-cards-wrapper", { opacity: 1 });
    gsap.from(".before-card", {
      x: -20, rotation: -5, opacity: 0, duration: 0.6, ease: "power2.out", delay: 0.1,
    });
    gsap.from(".after-card", {
      x: 20, rotation: 5, opacity: 0, duration: 0.6, ease: "power2.out", delay: 0.2,
    });

    const heroTl = gsap.timeline({ defaults: { ease: "power3.out" } });
    heroTl
      .from(".hero-headline", {
        y: 50,
        opacity: 0,
        duration: 1,
        delay: 0.15,
      })
      .from(".hero-sub", {
        y: 25,
        opacity: 0,
        duration: 0.8,
      }, "-=0.6")
      .from(".hero-cta", {
        y: 15,
        opacity: 0,
        scale: 0.95,
        duration: 0.6,
      }, "-=0.4");

    // Parallax on hero cards as user scrolls
    gsap.to(".hero-cards-wrapper", {
      scrollTrigger: {
        trigger: ".hero-section",
        start: "top top",
        end: "bottom top",
        scrub: 1,
      },
      y: -60,
      ease: "none",
    });

    // ═══ BOOK FLIP ANIMATION on feature cards ═══
    gsap.utils.toArray<HTMLElement>(".feature-card").forEach((card) => {
      gsap.from(card, {
        scrollTrigger: { trigger: card, start: "top 85%" },
        rotationY: 8,
        opacity: 0,
        y: 40,
        duration: 1,
        ease: "power3.out",
        transformPerspective: 800,
        transformOrigin: "left center",
      });
    });

    // ═══ BOOK PAGE TURN on step cards ═══
    gsap.from(".step-card", {
      scrollTrigger: { trigger: ".steps-grid", start: "top 80%" },
      rotationY: -15,
      opacity: 0,
      x: -30,
      duration: 0.9,
      stagger: 0.2,
      ease: "power3.out",
      transformPerspective: 1000,
      transformOrigin: "right center",
    });

    // ═══ STATS ANIMATIONS ═══
    gsap.from(".stat-item", {
      scrollTrigger: { trigger: ".stats-section", start: "top 85%" },
      y: 40,
      opacity: 0,
      duration: 0.7,
      stagger: 0.12,
      ease: "power2.out",
    });

    // Animate stat numbers counting up
    document.querySelectorAll<HTMLElement>(".stat-number").forEach((el) => {
      const target = parseFloat(el.dataset.value || "0");
      const obj = { val: 0 };
      ScrollTrigger.create({
        trigger: el,
        start: "top 85%",
        onEnter: () => {
          gsap.to(obj, {
            val: target,
            duration: 1.5,
            ease: "power2.out",
            onUpdate: () => {
              el.textContent = (el.dataset.suffix === "%" ? Math.round(obj.val) + "%" : (obj.val % 1 === 0 ? Math.round(obj.val) : obj.val.toFixed(0)) + (el.dataset.suffix || ""));
            },
          });
        },
        once: true,
      });
    });

    // ═══ SECTION HEADINGS — typewriter-like reveal ═══
    gsap.utils.toArray<HTMLElement>(".section-heading").forEach((el) => {
      gsap.from(el, {
        scrollTrigger: { trigger: el, start: "top 85%" },
        y: 40,
        opacity: 0,
        duration: 0.9,
        ease: "power3.out",
      });
    });

    // Feature card images scale in with a slight book-open effect
    gsap.utils.toArray<HTMLElement>(".feature-img").forEach((el) => {
      gsap.from(el, {
        scrollTrigger: { trigger: el, start: "top 88%" },
        scaleY: 0.85,
        opacity: 0,
        duration: 0.8,
        ease: "power2.out",
        transformOrigin: "bottom center",
      });
    });

    // Step numbers pop like stamps
    gsap.from(".step-number", {
      scrollTrigger: { trigger: ".steps-grid", start: "top 80%" },
      scale: 3,
      opacity: 0,
      duration: 0.5,
      stagger: 0.2,
      ease: "back.out(1.5)",
      delay: 0.4,
    });

    // ═══ PRODUCT IMAGE ═══
    gsap.from(".product-image", {
      scrollTrigger: { trigger: ".product-image", start: "top 85%" },
      y: 60,
      opacity: 0,
      scale: 0.96,
      duration: 1.2,
      ease: "power2.out",
    });

    // ═══ CTA BANNER ═══
    const ctaTl = gsap.timeline({
      scrollTrigger: { trigger: ".cta-section", start: "top 80%" },
    });
    ctaTl
      .from(".cta-heading", { y: 40, opacity: 0, duration: 0.9, ease: "power3.out" })
      .from(".cta-sub", { y: 30, opacity: 0, duration: 0.7, ease: "power2.out" }, "-=0.5")
      .from(".cta-btn", { y: 20, opacity: 0, scale: 0.95, duration: 0.6, ease: "back.out(1.3)" }, "-=0.3");

    // ═══ FOOTER ═══
    gsap.from(".footer-content", {
      scrollTrigger: { trigger: "footer", start: "top 90%" },
      y: 30,
      opacity: 0,
      duration: 0.8,
      ease: "power2.out",
    });

  }, { scope: container });

  return (
    <div ref={container} className="min-h-screen bg-white overflow-x-hidden">

      {/* ═══════ HERO: Sky Gradient with outer padding ═══════ */}
      <div className="p-2 md:p-3 bg-white">
        <section
          className="hero-section relative w-full min-h-[calc(100vh-24px)] flex flex-col items-center justify-center overflow-hidden rounded-[20px] md:rounded-[28px]"
          style={{ background: "linear-gradient(180deg, #779bc1 0%, #9abfda 48%, #cbdcec 80%, #e4ecf3 100%)" }}
        >
          <Navigation />
          <FloatingElements />

        {/* Centered content */}
        <div className="relative z-10 text-center px-6 pt-20 pb-0 flex-1 flex flex-col items-center justify-center">
          <h1 className="hero-headline font-[family-name:var(--font-display)] text-white font-bold text-[52px] md:text-[72px] lg:text-[80px] leading-[0.92] tracking-[-0.04em] mb-6 max-w-[700px]">
            Students, not<br />paperwork
          </h1>

          <div className="hero-sub max-w-[520px] mx-auto mb-8">
            <p className="font-[family-name:var(--font-display)] text-white/90 text-[16px] md:text-[17px] leading-[1.5] tracking-[-0.01em]">
              Generate study plans instantly that <strong className="text-white font-semibold">sound like you</strong>.<br />
              Enjoy <strong className="text-white font-semibold">unlimited, conflict-free</strong> scheduling.<br />
              Save <strong className="text-white font-semibold">5+ hours weekly</strong> on planning.
            </p>
          </div>

          <div className="hero-cta">
            <Link href="/register">
              <button className="px-8 py-3.5 rounded-full bg-[#070709] text-white text-[15px] font-semibold tracking-[-0.01em] shadow-[rgba(36,36,40,0.1)_0px_1px_2px_0px,rgba(36,36,40,0.09)_0px_3px_3px_0px,rgba(36,36,40,0.05)_0px_6px_4px_0px,rgba(36,36,40,0.01)_0px_11px_4px_0px] hover:bg-[#1a1a1c] transition-all duration-300 hover:shadow-[rgba(36,36,40,0.15)_0px_2px_4px_0px,rgba(36,36,40,0.12)_0px_6px_6px_0px,rgba(36,36,40,0.08)_0px_12px_8px_0px]">
                Sign up for free
              </button>
            </Link>
          </div>
        </div>

        {/* Before/After cards emerging from bottom */}
        <div className="hero-cards-wrapper relative z-10 w-full flex items-end justify-center mt-auto pb-0">
          {/* White "envelope" shape behind the cards */}
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[500px] md:w-[700px] h-[250px]">
            <svg viewBox="0 0 700 250" fill="none" className="w-full h-full" preserveAspectRatio="none">
              <path d="M0 250 L100 60 L350 0 L600 60 L700 250 Z" fill="white" fillOpacity="0.15" />
              <path d="M50 250 L150 80 L350 20 L550 80 L650 250 Z" fill="white" fillOpacity="0.25" />
              <path d="M100 250 L200 100 L350 50 L500 100 L600 250 Z" fill="white" fillOpacity="0.5" />
            </svg>
          </div>

          <div className="relative flex items-end justify-center gap-0 translate-y-[60px] md:translate-y-[80px]">
            {/* "Before" card */}
            <div className="before-card relative z-10 bg-white rounded-t-[14px] shadow-[rgba(16,55,132,0.06)_0px_10px_30px_0px] p-5 w-[200px] md:w-[250px] -rotate-3 -mr-6">
              <div className="flex items-center gap-1.5 mb-3">
                <div className="px-2.5 py-0.5 rounded-full border border-[#070709]/15 text-[11px] font-medium tracking-[-0.01em] text-[#070709] flex items-center gap-1">
                  <span className="text-[#2597d0] text-[10px]">✎</span> Before
                </div>
              </div>
              <div className="space-y-2">
                <div className="h-2.5 bg-[#f5f5f5] rounded-full w-full"></div>
                <div className="h-2.5 bg-[#f5f5f5] rounded-full w-[85%]"></div>
                <div className="h-2.5 bg-red-50 rounded-full w-[70%]"></div>
                <div className="h-2.5 bg-[#f5f5f5] rounded-full w-full"></div>
                <div className="h-2.5 bg-red-50 rounded-full w-[60%]"></div>
              </div>
            </div>

            {/* "After" card (overlapping, slightly above) */}
            <div className="after-card relative z-20 bg-white rounded-t-[14px] shadow-[rgba(16,55,132,0.08)_0px_10px_30px_0px] p-5 w-[220px] md:w-[280px] rotate-1 -translate-y-4">
              <div className="flex items-center gap-1.5 mb-3">
                <div className="px-2.5 py-0.5 rounded-full border border-[#070709]/15 text-[11px] font-medium tracking-[-0.01em] text-[#070709] flex items-center gap-1">
                  <span className="text-[#2597d0] text-[10px]">✓</span> After
                </div>
              </div>
              <div className="space-y-1.5 text-[12px] text-[#070709] leading-[1.5] font-[family-name:var(--font-display)]">
                <p className="text-[#8b8b8b] text-[11px]">Your weekly plan,</p>
                <p>Monday — Data Structures (2h)</p>
                <p>Tuesday — Linear Algebra (1.5h)</p>
                <p>Wednesday — Essay Draft (2h)</p>
                <p className="text-[#8b8b8b]">Thursday — Algorithms rev...</p>
                <p className="text-[#8b8b8b]">Friday — Physics lab pre...</p>
              </div>
            </div>
          </div>
        </div>
        </section>
      </div>

      {/* ═══════ Stats Row ═══════ */}
      <section className="stats-section bg-white border-b border-[#f5f5f5]">
        <div className="max-w-[1200px] mx-auto px-6 py-20 flex flex-wrap items-center justify-center gap-16 md:gap-24">
          {[
            { value: 5, suffix: "+", label: "Hours saved weekly" },
            { value: 98, suffix: "%", label: "Schedule accuracy" },
            { value: 0, suffix: "", label: "Conflicts generated" },
          ].map((stat, i) => (
            <div key={i} className="stat-item text-center">
              <div
                className="stat-number font-[family-name:var(--font-display)] text-[48px] font-bold tracking-[-0.04em] text-[#070709] leading-[1.1]"
                data-value={stat.value}
                data-suffix={stat.suffix}
              >
                0{stat.suffix}
              </div>
              <div className="text-[14px] text-[#60606c] tracking-[-0.01em] mt-1 font-medium">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════ Section Heading ═══════ */}
      <section className="bg-[#f5f5f5] pt-28 pb-8">
        <div className="max-w-[1200px] mx-auto px-6 text-center">
          <h2 className="section-heading font-[family-name:var(--font-display)] text-[36px] md:text-[44px] font-semibold tracking-[-0.04em] text-[#070709] leading-[1.1]">
            Save <span className="text-[#2597d0]">5</span> hours a week with Studyflow
          </h2>
        </div>
      </section>

      {/* ═══════ Feature Cards (2-column) ═══════ */}
      <section id="features" className="bg-[#f5f5f5] py-16">
        <div className="feature-grid max-w-[1200px] mx-auto px-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Card 1: Scheduling */}
          <div className="feature-card bg-white rounded-[18px] border border-[#f5f5f5] p-10 md:p-12 shadow-[rgba(16,55,132,0.03)_0px_17px_37px_0px,rgba(16,55,132,0.03)_0px_67px_67px_0px,rgba(16,55,132,0.02)_0px_150px_90px_0px] hover:shadow-[rgba(16,55,132,0.05)_0px_20px_40px_0px,rgba(16,55,132,0.04)_0px_70px_70px_0px] transition-shadow duration-500">
            <div className="flex items-center gap-2 mb-6">
              <div className="px-3 py-1 rounded-full border border-[#070709] text-[12px] font-medium tracking-[-0.01em] text-[#070709] flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-[#2597d0]" />
                Schedule
              </div>
            </div>
            <h3 className="font-[family-name:var(--font-display)] text-[24px] md:text-[28px] font-semibold tracking-[-0.04em] text-[#070709] leading-[1.2] mb-4">
              Adaptive scheduling that recalibrates.
            </h3>
            <p className="text-[16px] text-[#60606c] leading-[1.5] tracking-[-0.01em] mb-8">
              Input your availability, syllabus, and deadlines. The engine works backward to calculate exactly what you need each week — and adjusts when life happens.
            </p>
            <div className="feature-img rounded-[12px] overflow-hidden border border-[#f5f5f5]">
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
          <div className="feature-card bg-white rounded-[18px] border border-[#f5f5f5] p-10 md:p-12 shadow-[rgba(16,55,132,0.03)_0px_17px_37px_0px,rgba(16,55,132,0.03)_0px_67px_67px_0px,rgba(16,55,132,0.02)_0px_150px_90px_0px] hover:shadow-[rgba(16,55,132,0.05)_0px_20px_40px_0px,rgba(16,55,132,0.04)_0px_70px_70px_0px] transition-shadow duration-500">
            <div className="flex items-center gap-2 mb-6">
              <div className="px-3 py-1 rounded-full border border-[#070709] text-[12px] font-medium tracking-[-0.01em] text-[#070709] flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5 text-[#2597d0]" />
                Progress
              </div>
            </div>
            <h3 className="font-[family-name:var(--font-display)] text-[24px] md:text-[28px] font-semibold tracking-[-0.04em] text-[#070709] leading-[1.2] mb-4">
              Track every minute. See every gain.
            </h3>
            <p className="text-[16px] text-[#60606c] leading-[1.5] tracking-[-0.01em] mb-8">
              Visual progress tracking across subjects, assignments, and revision goals. Watch your study hours compound into mastery.
            </p>
            <div className="feature-img rounded-[12px] overflow-hidden border border-[#f5f5f5]">
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
    
      <section id="how-it-works" className="bg-[#f5f5f5] py-28">
        <div className="max-w-[1200px] mx-auto px-6">
          <h2 className="section-heading font-[family-name:var(--font-display)] text-[36px] md:text-[44px] font-semibold tracking-[-0.04em] text-[#070709] leading-[1.1] text-center mb-16">
            How Studyflow works
          </h2>

          <div className="steps-grid grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                icon: Target,
                step: "01",
                title: "Set your constraints",
                desc: "Add your courses, deadlines, and available time blocks. Tell us when you're free and when you're not.",
              },
              {
                icon: Sparkles,
                step: "02",
                title: "Engine generates your plan",
                desc: "Our algorithm distributes workload evenly, respecting priorities and preventing burnout before exam season.",
              },
              {
                icon: Clock,
                step: "03",
                title: "Adapt and recalibrate",
                desc: "Missed a session? Plans shift automatically. The engine continuously recalibrates so you never fall behind.",
              },
            ].map((item, i) => (
              <div key={i} className="step-card bg-white rounded-[18px] p-8 shadow-[rgba(16,55,132,0.03)_0px_17px_37px_0px,rgba(16,55,132,0.03)_0px_67px_67px_0px,rgba(16,55,132,0.02)_0px_150px_90px_0px] hover:-translate-y-1 transition-transform duration-300">
                <div className="flex items-center justify-between mb-6">
                  <div className="w-10 h-10 rounded-lg bg-[#f5f5f5] flex items-center justify-center">
                    <item.icon className="w-5 h-5 text-[#2597d0]" />
                  </div>
                  <span className="step-number font-[family-name:var(--font-display)] text-[48px] font-bold text-[#f5f5f5] leading-none tracking-[-0.04em]">
                    {item.step}
                  </span>
                </div>
                <h3 className="font-[family-name:var(--font-display)] text-[20px] font-semibold tracking-[-0.01em] text-[#070709] leading-[1.3] mb-3">
                  {item.title}
                </h3>
                <p className="text-[14px] text-[#60606c] leading-[1.5] tracking-[-0.01em]">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ Full Width Product Image ═══════ */}
      <section className="bg-white py-28">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="product-image rounded-[24px] overflow-hidden shadow-[rgba(16,55,132,0.03)_0px_17px_37px_0px,rgba(16,55,132,0.03)_0px_67px_67px_0px,rgba(16,55,132,0.02)_0px_150px_90px_0px]">
            <Image
              src="/landing/hero-study-app.png"
              alt="Studyflow app interface"
              width={1200}
              height={600}
              className="w-full h-auto"
            />
          </div>
        </div>
      </section>

      {/* ═══════ CTA Banner ═══════ */}
      <section className="cta-section bg-white py-28">
        <div className="max-w-[700px] mx-auto px-6 text-center">
          <h2 className="cta-heading font-[family-name:var(--font-display)] text-[36px] md:text-[44px] font-semibold tracking-[-0.04em] text-[#070709] leading-[1.1] mb-6">
            Stop fighting your schedule.
          </h2>
          <p className="cta-sub text-[16px] md:text-[18px] text-[#60606c] leading-[1.5] tracking-[-0.01em] mb-10 max-w-[480px] mx-auto">
            Join students who have already transformed their academic workflow with adaptive study planning.
          </p>
          <div className="cta-btn flex items-center justify-center gap-4">
            <Link href="/register">
              <button className="px-8 py-3.5 rounded-full bg-[#070709] text-white text-[16px] font-semibold tracking-[-0.01em] shadow-[rgba(36,36,40,0.1)_0px_1px_2px_0px,rgba(36,36,40,0.09)_0px_3px_3px_0px,rgba(36,36,40,0.05)_0px_6px_4px_0px,rgba(36,36,40,0.01)_0px_11px_4px_0px] hover:bg-[#1a1a1c] transition-all duration-300">
                Get started for free
              </button>
            </Link>
            <Link href="/dashboard">
              <button className="px-6 py-3.5 rounded-full border border-[#070709] text-[#070709] text-[16px] font-medium tracking-[-0.01em] hover:bg-[#f5f5f5] transition-colors">
                View demo
              </button>
            </Link>
          </div>
        </div>
      </section>

      {/* ═══════ Footer ═══════ */}
      <footer className="bg-white border-t border-[#f5f5f5] py-16">
        <div className="footer-content max-w-[1200px] mx-auto px-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#2597d0] flex items-center justify-center">
              <BookOpen className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-[family-name:var(--font-display)] font-bold text-[16px] tracking-[-0.01em] text-[#070709]">
              Studyflow
            </span>
          </div>

          <div className="flex flex-wrap gap-8">
            <Link href="#features" className="text-[14px] text-[#60606c] hover:text-[#070709] transition-colors">Features</Link>
            <Link href="#how-it-works" className="text-[14px] text-[#60606c] hover:text-[#070709] transition-colors">How it works</Link>
            <Link href="#pricing" className="text-[14px] text-[#60606c] hover:text-[#070709] transition-colors">Pricing</Link>
            <span className="text-[14px] text-[#60606c] cursor-pointer hover:text-[#070709] transition-colors">Privacy</span>
            <span className="text-[14px] text-[#60606c] cursor-pointer hover:text-[#070709] transition-colors">Terms</span>
          </div>

          <p className="text-[12px] text-[#8b8b8b]">© 2026 Studyflow</p>
        </div>
      </footer>
    </div>
  );
}
