import type { Metadata } from "next";
import { Bricolage_Grotesque, IBM_Plex_Mono, Inter } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { SessionProvider } from "@/hooks/use-session";
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
  title: "StudyFlow — Know if your coursework fits",
  description:
    "StudyFlow weighs the coursework you owe against the study time you actually have, so you find out you are overcommitted while there is still time to do something about it.",
  keywords: ["study planner", "academic workload", "student productivity", "deadline tracking"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${bricolage.variable} ${plexMono.variable} h-full`}
    >
      <body className="min-h-full font-sans antialiased">
        <SessionProvider>
          <TooltipProvider>
            {children}
            <Toaster position="bottom-right" richColors />
          </TooltipProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
