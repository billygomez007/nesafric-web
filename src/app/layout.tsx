import type { Metadata } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import { GoogleAnalytics } from "@next/third-parties/google";
import { BRAND } from "@/platform/brand";
import { GA_MEASUREMENT_ID } from "@/platform/analytics";
import "./globals.css";

const montserrat = localFont({
  src: [
    { path: "../modules/documents/assets/fonts/NotoSans-Regular.ttf", weight: "400" },
    { path: "../modules/documents/assets/fonts/NotoSans-Bold.ttf", weight: "700" },
  ],
  variable: "--font-montserrat",
});

const geistMono = localFont({
  src: "../modules/documents/assets/fonts/NotoSans-Regular.ttf",
  variable: "--font-geist-mono",
});

const TITLE = `${BRAND.name} | Real Estate OS for Africa`;
const DESCRIPTION =
  "NesAfric is the intelligent real estate operating and marketplace platform for Africa: properties, people, payments, maintenance and opportunities in one connected workspace.";
const SOCIAL_DESCRIPTION =
  "Real Estate OS for Africa for owners, managers, agents, brokers, developers and service professionals.";

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
