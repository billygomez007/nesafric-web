import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Google Cloud Run runs the traced `.next/standalone` server in a container (see Dockerfile and
  // docs/cloud-run-deployment.md), so the image carries only the files the app actually loads.
  output: "standalone",
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // The marketplace landing page is the site root. /marketplace (exact path only) permanently
  // redirects there so the two never compete as duplicate content; every deeper
  // /marketplace/* route (properties, professionals, services, profiles) is unaffected.
  async redirects() {
    return [{ source: "/marketplace", destination: "/", permanent: true }];
  },
  // Use native Node `require` for the Postgres driver adapter stack instead of bundling —
  // avoids production-only breakage of `pg`'s conditional/dynamic requires under per-route
  // output file tracing.
  serverExternalPackages: ["pg", "pg-cloudflare", "@prisma/adapter-pg"],
};

export default nextConfig;
