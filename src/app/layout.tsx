import type { Metadata } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import { GoogleTagManager } from "@next/third-parties/google";
import { BRAND } from "@/platform/brand";
import { GTM_CONTAINER_ID } from "@/platform/analytics";
import "./globals.css";

/*
 * NesAfric type pairing. Both are self-hosted variable fonts (SIL OFL, see ./fonts) so every
 * weight the UI asks for is real and builds never depend on a network font fetch.
 * - Montserrat: brand/display — page titles, major headings, navigation, marketing display.
 * - Inter: text — body copy, forms, tables and dense operational data (large x-height at the
 *   10–13px sizes the workspaces use, true tabular figures for money).
 */
const montserrat = localFont({
  src: "./fonts/Montserrat-Variable-latin.woff2",
  weight: "100 900",
  variable: "--font-montserrat",
  display: "swap",
});

const inter = localFont({
  src: "./fonts/Inter-Variable-latin.woff2",
  weight: "100 900",
  variable: "--font-inter",
  display: "swap",
});

const TITLE = `${BRAND.name} | ${BRAND.tagline}`;
const DESCRIPTION =
  "NesAfric is a Ghana-first property marketplace — homes, land and commercial property to rent or buy — backed by an operating platform for landlords, managers, agents and developers.";
const SOCIAL_DESCRIPTION =
  "Find property to rent or buy across Ghana, on the operating system for real estate.";

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
      className={`${montserrat.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
      {/* Google Tag Manager is loaded once globally when NEXT_PUBLIC_GTM_ID is configured. */}
      {GTM_CONTAINER_ID && <GoogleTagManager gtmId={GTM_CONTAINER_ID} />}
    </html>
  );
}
