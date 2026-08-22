"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { User, Shield, SlidersHorizontal, Globe } from "lucide-react";

const navItems = [
  { title: "Profile",     href: "/settings/profile",     icon: User },
  { title: "Security",    href: "/settings/security",    icon: Shield },
  { title: "Preferences", href: "/settings/preferences", icon: SlidersHorizontal },
  { title: "Timezone",    href: "/settings/timezone",    icon: Globe },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your account, security, and scheduling preferences
        </p>
      </div>

      <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
        {/* Sidebar nav */}
        <aside className="lg:w-48 shrink-0">
          <nav className="flex gap-1 lg:flex-col">
            {navItems.map(({ title, href, icon: Icon }) => {
              const isActive = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    buttonVariants({ variant: "ghost" }),
                    "justify-start gap-2.5 h-9",
                    isActive
                      ? "bg-muted text-foreground font-medium hover:bg-muted"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {title}
                </Link>
              );
            })}
          </nav>
        </aside>

        {/* Page content */}
        <div className="flex-1 min-w-0 max-w-2xl">
          {children}
        </div>
      </div>
    </div>
  );
}
