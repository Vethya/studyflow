import type { Metadata } from "next";
import { headers } from "next/headers";
import { Bricolage_Grotesque, IBM_Plex_Mono, Inter } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { SessionProvider } from "@/hooks/use-session";
import { ThemeProvider } from "@/components/theme-provider";
import { StudyFlowSWRProvider } from "@/components/swr-provider";
import { DENSITY_BOOT_SCRIPT } from "@/lib/density-script";
import { NONCE_HEADER } from "@/lib/security/headers";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// Display face. Bricolage has enough character to carry the headline figures
// without the interface needing decoration anywhere else.
const bricolage = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

// Every duration, count and clock time in the product is set in this face, so
// columns of figures line up and read as measurements rather than prose.
const plexMono = IBM_Plex_Mono({
  variable: "--font-data",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Know if your coursework fits | StudyFlow",
  description:
    "StudyFlow compares your coursework with the hours you’re free and tells you how many hours short you are, weeks before anything is due.",
  keywords: ["study planner", "academic workload", "student productivity", "deadline tracking"],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Reading request headers also makes every page render per request, which a
  // nonce-based CSP requires: a prerendered page would carry no nonce.
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${bricolage.variable} ${plexMono.variable} h-full`}
    >
      <body className="min-h-full font-sans antialiased">
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: DENSITY_BOOT_SCRIPT }} />
        <ThemeProvider nonce={nonce}>
          <StudyFlowSWRProvider>
            <SessionProvider>
              <TooltipProvider>
                {children}
                <Toaster position="bottom-right" richColors />
              </TooltipProvider>
            </SessionProvider>
          </StudyFlowSWRProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
