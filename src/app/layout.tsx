import type { Metadata } from "next";
import { Barlow_Condensed, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Self-hosted by next/font, so no external stylesheet and no CDN dependency.
const display = Barlow_Condensed({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const body = Inter({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Scrollcast Studio",
  description:
    "Turn a PDF into a scrolling or sliding video, with music, platform aspect ratios and title cards.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${mono.variable} h-full`}
    >
      <body className="h-full antialiased">{children}</body>
    </html>
  );
}
