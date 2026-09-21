import type { Metadata, Viewport } from "next";
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

/**
 * Set this to the real address before going public — Open Graph images and
 * canonical URLs have to be absolute, and search engines treat a wrong
 * canonical as a pointer to someone else's page.
 */
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

const title = "Scrollcast — Turn a PDF into a video";
const description =
  "Turn any PDF into a scrolling video for YouTube, Shorts, TikTok, Reels, Instagram or Facebook. Add music, a title and your channel name, then download an MP4. Free, and your file never leaves your computer.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: title,
    // Sub-pages get "Something — Scrollcast" without repeating the tagline.
    template: "%s — Scrollcast",
  },
  description,
  applicationName: "Scrollcast",
  keywords: [
    "pdf to video",
    "convert pdf to video",
    "pdf to mp4",
    "scrolling pdf video",
    "pdf to youtube video",
    "pdf to shorts",
    "pdf to reels",
    "assignment video maker",
    "document to video converter",
  ],
  authors: [{ name: "Scrollcast" }],
  creator: "Scrollcast",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Scrollcast",
    title,
    description,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Scrollcast — turn a PDF into a video" }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  category: "technology",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The editor is a dark tool; matching the browser chrome avoids a white
  // bar above the page on phones.
  themeColor: "#0d0f14",
  colorScheme: "dark",
};

/**
 * Structured data, so a search result can show this as a named application
 * rather than a bare link. Kept to what is actually true: it is free, it
 * runs in a browser, and it makes video files.
 */
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Scrollcast",
  url: siteUrl,
  description,
  applicationCategory: "MultimediaApplication",
  operatingSystem: "Any",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  featureList: [
    "Turn a PDF into a scrolling video",
    "YouTube, Shorts, TikTok, Reels, Instagram and Facebook sizes",
    "Background music",
    "Title and closing cards",
    "Page numbers and a watermark",
  ],
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
      <body className="h-full antialiased">
        <script
          type="application/ld+json"
          // The object is ours, not user input, so there is nothing to escape.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {children}
      </body>
    </html>
  );
}
