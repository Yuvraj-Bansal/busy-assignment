// app/layout.tsx
//
// Root layout. Not explicitly requested in the brief, but the App Router
// requires exactly one root layout with <html>/<body> for any route group
// (including `(dashboard)`) to render — included here as minimal supporting
// scaffolding. Auth pages (`/login`, not built in this pass) would also
// live outside `(dashboard)` and share this root layout.

import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Event Registration Console",
  description: "Session check-in and registration management.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
