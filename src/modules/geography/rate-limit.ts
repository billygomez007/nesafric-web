import { AppError } from "@/platform/errors";
import { ipRateLimitKey, resolveClientIdentity } from "@/platform/security/client-ip";

/**
 * Best-effort, per-process limit for public geography reads and resolution (cheap, cached
 * queries; this only stops a single client hammering the locality search). Fixed one-minute
 * windows per client IP and route.
 */
const WINDOW_MS = 60_000;
export const GEO_RATE_LIMIT = { policy: "public-geography-read", limit: 120, windowSeconds: 60 } as const;
const windows = new Map<string, { start: number; count: number }>();

export function assertGeoRateLimit(request: Request, route: string, limit: number = GEO_RATE_LIMIT.limit, now = Date.now()) {
  const key = `${route}:${ipRateLimitKey(resolveClientIdentity(request.headers).ip)}`;
  const current = windows.get(key);
  if (!current || now - current.start >= WINDOW_MS) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 20_000) for (const [entry, value] of windows) if (now - value.start >= WINDOW_MS) windows.delete(entry);
    return;
  }
  current.count += 1;
  if (current.count > limit) throw new AppError("RATE_LIMITED", 429, "Too many location requests. Please wait a minute and try again.");
}

export const geoReadHeaders = {
  "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
  "X-RateLimit-Policy": `${GEO_RATE_LIMIT.policy};w=${GEO_RATE_LIMIT.windowSeconds};limit=${GEO_RATE_LIMIT.limit}`,
};
