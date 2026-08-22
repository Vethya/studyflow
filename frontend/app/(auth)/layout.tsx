export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left — brand panel */}
      <div className="hidden lg:flex flex-col relative overflow-hidden bg-zinc-950">
        {/* Subtle grid */}
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, white 1px, transparent 0)`,
            backgroundSize: "28px 28px",
          }}
        />
        {/* Gradient orbs */}
        <div className="absolute top-1/3 left-1/4 w-72 h-72 bg-violet-600/30 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-indigo-500/20 rounded-full blur-3xl" />

        {/* Content */}
        <div className="relative z-10 flex flex-col h-full p-10">
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 backdrop-blur-sm">
              <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l9-5-9-5-9 5 9 5z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
              </svg>
            </div>
            <span className="font-semibold text-white text-lg tracking-tight">StudyFlow</span>
          </div>

          {/* Hero */}
          <div className="flex-1 flex flex-col justify-center gap-8">
            <div className="space-y-3">
              <h1 className="text-3xl font-bold text-white leading-tight">
                Plan smarter.<br />
                Stress less.<br />
                <span className="text-violet-400">Achieve more.</span>
              </h1>
              <p className="text-zinc-400 text-sm leading-relaxed max-w-xs">
                StudyFlow is an AI-powered study planner built for university students. Deadlines, sessions, and priorities — all handled automatically.
              </p>
            </div>

            {/* Feature list */}
            <div className="space-y-3">
              {[
                { title: "Smart scheduling",  desc: "Sessions fit around your availability automatically" },
                { title: "Deadline tracking",  desc: "Never miss a submission with smart reminders" },
                { title: "Progress insights", desc: "See exactly how your effort maps to your workload" },
              ].map((f) => (
                <div key={f.title} className="flex items-start gap-3">
                  <div className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-violet-500/20 flex items-center justify-center">
                    <div className="h-2 w-2 rounded-full bg-violet-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{f.title}</p>
                    <p className="text-xs text-zinc-400">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs text-zinc-600">© 2026 StudyFlow. Built for students.</p>
        </div>
      </div>

      {/* Right — auth form */}
      <div className="flex items-center justify-center p-6 bg-background">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground">
              <svg className="h-4 w-4 text-background" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l9-5-9-5-9 5 9 5z" />
              </svg>
            </div>
            <span className="font-semibold text-base">StudyFlow</span>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
