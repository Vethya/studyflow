"use client";

import Link from "next/link";
import { useSession } from "@/hooks/use-session";

const buttonClassName = "px-5 py-2 rounded-full bg-white text-[#070709] text-[14px] font-medium tracking-[-0.01em] hover:bg-white/90 transition-colors shadow-[rgba(36,36,40,0.1)_0px_1px_2px_0px]";

export function NavAuth() {
  const { status } = useSession();

  return (
    <div className="flex items-center gap-4">
      {status === "loading" ? (
        <div aria-hidden className="h-9 w-28" />
      ) : status === "authenticated" ? (
        <Link href="/dashboard" className={buttonClassName}>Open dashboard</Link>
      ) : (
        <>
          <Link href="/login" className="text-[14px] font-medium tracking-[-0.01em] text-white hover:text-white/80 transition-colors">Login</Link>
          <Link href="/register" className={buttonClassName}>Sign up</Link>
        </>
      )}
    </div>
  );
}
