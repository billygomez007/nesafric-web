import type { Metadata } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import { GoogleTagManager } from "@next/third-parties/google";
import { BRAND } from "@/platform/brand";
import { GTM_CONTAINER_ID } from "@/platform/analytics";
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
      {/* Google Tag Manager is loaded once globally when NEXT_PUBLIC_GTM_ID is configured. */}
      {GTM_CONTAINER_ID && <GoogleTagManager gtmId={GTM_CONTAINER_ID} />}
    </html>
  );
}
