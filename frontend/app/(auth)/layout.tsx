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
        {/* One warm bloom, on the deficit hue the product reserves for
            "this does not fit" — the problem the page is selling a fix for. */}
        <div className="absolute bottom-1/3 left-1/4 h-80 w-80 rounded-full bg-deficit/20 blur-3xl" />

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
              <h1 className="font-display text-3xl font-bold leading-tight text-white">
                Find out it doesn&apos;t fit<br />
                <span className="text-deficit">while you can still</span><br />
                do something about it.
              </h1>
              <p className="max-w-xs text-sm leading-relaxed text-zinc-400">
                StudyFlow weighs the coursework you owe against the study hours you
                actually have, and tells you plainly when the two do not add up.
              </p>
            </div>

            {/* Feature list */}
            <div className="space-y-3">
              {[
                { title: "Your real hours", desc: "Set the weekly windows you are free, and block out the weeks you are not" },
                { title: "Every deadline", desc: "Track coursework with estimates, priorities and due dates" },
                { title: "One honest number", desc: "See how far over — or under — your capacity you are" },
              ].map((f) => (
                <div key={f.title} className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10">
                    <div className="h-1.5 w-1.5 rounded-full bg-white/70" />
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
