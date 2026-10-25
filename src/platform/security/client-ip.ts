import { BlockList, isIP } from "net";

/**
 * Resolves the client IP used as a rate-limit identity for unauthenticated public writes.
 *
 * Only headers written by infrastructure we control are trusted — never a value the caller can set:
 *
 * - On Vercel (`VERCEL=1`), `x-real-ip` / `x-forwarded-for` are overwritten by Vercel's edge with the
 *   address that connected to it; external values are not forwarded ("to prevent spoofing",
 *   vercel.com/docs/headers/request-headers). That connecting address is the "peer".
 * - On Google Cloud Run (`K_SERVICE` is set by the platform), Google's front end appends the address
 *   that connected to it to `x-forwarded-for`, after anything the caller sent, so only the LAST entry
 *   is trusted. Behind a Google external Application Load Balancer the load balancer appends its own
 *   address after the client's; set `CLOUD_RUN_BEHIND_LOAD_BALANCER=true` to take the one before it.
 *   `TRUSTED_CLIENT_IP_HEADER`, when set, still wins (for a proxy that overwrites one header).
 * - Elsewhere, an operator may name one header their own proxy overwrites via
 *   `TRUSTED_CLIENT_IP_HEADER`. With neither, there is no trustworthy identity (`ip: null`).
 * - See docs/guest-write-protection.md for the evidence required before trusting Cloudflare.
 * - `cf-connecting-ip` is only honoured when `TRUST_CLOUDFLARE_CLIENT_IP=true` AND the peer is inside
 *   Cloudflare's published ranges — i.e. the request demonstrably came through Cloudflare, which
 *   overwrites that header. Off by default: if Cloudflare is not proxying the domain, trusting it
 *   would let anyone relaying through Cloudflare (e.g. a Worker) choose their own identity.
 */

/** Cloudflare's published ranges (cloudflare.com/ips). Override with `CLOUDFLARE_IP_RANGES` (comma-separated CIDRs). */
export const CLOUDFLARE_IP_RANGES = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18",
  "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17",
  "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32",
  "2a06:98c0::/29", "2c0f:f248::/32",
];

export type ClientIpSource = "vercel" | "cloud-run" | "configured-header" | "cloudflare" | "none";
export type ClientIdentity = { ip: string | null; source: ClientIpSource };

type Env = Record<string, string | undefined>;

function buildBlockList(ranges: string[]) {
  const list = new BlockList();
  for (const range of ranges) {
    const [address, prefix] = range.trim().split("/");
    const family = isIP(address);
    if (!family || !prefix) continue;
    list.addSubnet(address, Number(prefix), family === 6 ? "ipv6" : "ipv4");
  }
  return list;
}

let cachedRanges: { key: string; list: BlockList } | null = null;

function cloudflareBlockList(env: Env) {
  const key = env.CLOUDFLARE_IP_RANGES ?? "";
  if (!cachedRanges || cachedRanges.key !== key) {
    cachedRanges = { key, list: buildBlockList(key ? key.split(",") : CLOUDFLARE_IP_RANGES) };
  }
  return cachedRanges.list;
}

/** A single valid IP literal, or null. For list headers only the first entry is considered. */
function parseIp(value: string | null) {
  const candidate = value?.split(",")[0]?.trim() ?? "";
  return isIP(candidate) ? candidate : null;
}

/** The entry `fromEnd` places before the end of a comma-separated list header (0 = the last), or null. */
function parseIpFromEnd(value: string | null, fromEnd: number) {
  const entries = value?.split(",").map((entry) => entry.trim()) ?? [];
  const candidate = entries[entries.length - 1 - fromEnd] ?? "";
  return isIP(candidate) ? candidate : null;
}

export function isCloudflareIp(ip: string, env: Env = process.env) {
  const family = isIP(ip);
  if (!family) return false;
  return cloudflareBlockList(env).check(ip, family === 6 ? "ipv6" : "ipv4");
}

export function resolveClientIdentity(headers: Headers, env: Env = process.env): ClientIdentity {
  let peer: string | null = null;
  let source: ClientIpSource = "none";
  if (env.VERCEL === "1") {
    peer = parseIp(headers.get("x-real-ip")) ?? parseIp(headers.get("x-forwarded-for"));
    source = peer ? "vercel" : "none";
  } else if (env.TRUSTED_CLIENT_IP_HEADER) {
    peer = parseIp(headers.get(env.TRUSTED_CLIENT_IP_HEADER.trim().toLowerCase()));
    source = peer ? "configured-header" : "none";
  } else if (env.K_SERVICE) {
    peer = parseIpFromEnd(headers.get("x-forwarded-for"), env.CLOUD_RUN_BEHIND_LOAD_BALANCER === "true" ? 1 : 0);
    source = peer ? "cloud-run" : "none";
  }
  if (!peer) return { ip: null, source: "none" };

  if (env.TRUST_CLOUDFLARE_CLIENT_IP === "true" && isCloudflareIp(peer, env)) {
    const forwarded = parseIp(headers.get("cf-connecting-ip"));
    if (forwarded) return { ip: forwarded, source: "cloudflare" };
  }
  return { ip: peer, source };
}

/**
 * The rate-limit key for an IP: IPv4 as-is, IPv6 collapsed to its /64 (one subscriber's allocation),
 * so rotating addresses inside a single /64 doesn't mint new identities.
 */
export function ipRateLimitKey(ip: string | null) {
  if (!ip) return "unknown";
  if (isIP(ip) !== 6) return ip;
  const expanded = expandIpv6(ip);
  return `${expanded.slice(0, 4).join(":")}::/64`;
}

function expandIpv6(ip: string) {
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  // Embedded IPv4 (e.g. ::ffff:1.2.3.4) — the /64 prefix is all we need, so treat it as two groups.
  const last = tailParts.length ? tailParts : headParts;
  if (last.length && last[last.length - 1].includes(".")) last.splice(last.length - 1, 1, "0", "0");
  const missing = 8 - headParts.length - tailParts.length;
  const parts = ip.includes("::") ? [...headParts, ...Array(Math.max(missing, 0)).fill("0"), ...tailParts] : headParts;
  return parts.map((part) => part.replace(/^0+(?=.)/, "") || "0");
}
