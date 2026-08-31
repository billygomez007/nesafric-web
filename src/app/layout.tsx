import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist_Mono, Montserrat } from "next/font/google";
import { GoogleAnalytics } from "@next/third-parties/google";
import { BRAND } from "@/platform/brand";
import { GA_MEASUREMENT_ID } from "@/platform/analytics";
import "./globals.css";

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const TITLE = `${BRAND.name} — The Real Estate Operating & Marketplace Platform`;
const DESCRIPTION =
  "UmoAfric is the intelligent real estate operating and marketplace platform: owners, property managers and developers operate their portfolios; agents, brokers, brokerages and real estate companies market listings and grow their business; buyers and renters discover properties — with AI employees built in.";
const SOCIAL_DESCRIPTION =
  "The intelligent real estate operating and marketplace platform — for owners, managers, agents, brokers, brokerages and developers.";

export const metadata: Metadata = {
  metadataBase: new URL(BRAND.siteUrl),
  applicationName: BRAND.name,
  title: {
    default: TITLE,
    template: `%s | ${BRAND.name}`,
  },
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: BRAND.name,
    title: TITLE,
    description: SOCIAL_DESCRIPTION,
    url: BRAND.siteUrl,
    images: [{ url: BRAND.logo.og, width: 1200, height: 630, alt: BRAND.name }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: SOCIAL_DESCRIPTION,
    images: [BRAND.logo.og],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${montserrat.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
      {/* Only rendered when NEXT_PUBLIC_GA_MEASUREMENT_ID is set (production only, see
          @/platform/analytics) — local dev and Preview never load the tag. Loaded once here for
          every route; @next/third-parties' GoogleAnalytics already tracks client-side Next.js
          navigations as pageviews on its own, so this must never be duplicated elsewhere. */}
      {GA_MEASUREMENT_ID && <GoogleAnalytics gaId={GA_MEASUREMENT_ID} />}
    </html>
  );
}
