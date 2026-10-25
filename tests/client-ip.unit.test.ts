import { describe, expect, it } from "vitest";

import { ipRateLimitKey, isCloudflareIp, resolveClientIdentity } from "@/platform/security/client-ip";

const headers = (values: Record<string, string>) => new Headers(values);

describe("client IP identity (rate-limit key source)", () => {
  it("trusts no header when not on Vercel and no trusted header is configured", () => {
    const forged = headers({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "7.7.7.7", "cf-connecting-ip": "8.8.8.8" });
    expect(resolveClientIdentity(forged, {})).toEqual({ ip: null, source: "none" });
  });

  it("on Vercel uses the Vercel-overwritten x-real-ip and ignores a forged cf-connecting-ip by default", () => {
    const request = headers({ "x-real-ip": "41.66.1.10", "x-forwarded-for": "41.66.1.10", "cf-connecting-ip": "9.9.9.9" });
    expect(resolveClientIdentity(request, { VERCEL: "1" })).toEqual({ ip: "41.66.1.10", source: "vercel" });
  });

  it("ignores cf-connecting-ip even when Cloudflare trust is enabled if the peer is not a Cloudflare address", () => {
    const request = headers({ "x-real-ip": "41.66.1.10", "cf-connecting-ip": "9.9.9.9" });
    expect(resolveClientIdentity(request, { VERCEL: "1", TRUST_CLOUDFLARE_CLIENT_IP: "true" })).toEqual({ ip: "41.66.1.10", source: "vercel" });
  });

  it("uses cf-connecting-ip only when Cloudflare trust is enabled and the peer is in Cloudflare's ranges", () => {
    const viaCloudflare = headers({ "x-real-ip": "172.67.159.104", "cf-connecting-ip": "154.160.2.33" });
    expect(resolveClientIdentity(viaCloudflare, { VERCEL: "1", TRUST_CLOUDFLARE_CLIENT_IP: "true" })).toEqual({ ip: "154.160.2.33", source: "cloudflare" });
    // Same request with trust off: the (shared) Cloudflare edge address is the identity.
    expect(resolveClientIdentity(viaCloudflare, { VERCEL: "1" })).toEqual({ ip: "172.67.159.104", source: "vercel" });
  });

  it("rejects malformed header values instead of using them as identities", () => {
    expect(resolveClientIdentity(headers({ "x-real-ip": "not-an-ip" }), { VERCEL: "1" })).toEqual({ ip: null, source: "none" });
    const viaCloudflare = headers({ "x-real-ip": "104.21.58.116", "cf-connecting-ip": "<script>" });
    expect(resolveClientIdentity(viaCloudflare, { VERCEL: "1", TRUST_CLOUDFLARE_CLIENT_IP: "true" })).toEqual({ ip: "104.21.58.116", source: "vercel" });
  });

  it("supports an operator-configured trusted header off Vercel", () => {
    const request = headers({ "x-client-ip": "41.66.1.10", "x-forwarded-for": "6.6.6.6" });
    expect(resolveClientIdentity(request, { TRUSTED_CLIENT_IP_HEADER: "X-Client-IP" })).toEqual({ ip: "41.66.1.10", source: "configured-header" });
  });

  it("on Cloud Run trusts only the last x-forwarded-for entry, which Google's front end appends", () => {
    const forged = headers({ "x-forwarded-for": "6.6.6.6, 41.66.1.10", "x-real-ip": "7.7.7.7" });
    expect(resolveClientIdentity(forged, { K_SERVICE: "nesafric-web" })).toEqual({ ip: "41.66.1.10", source: "cloud-run" });
    expect(resolveClientIdentity(headers({ "x-forwarded-for": "41.66.1.10" }), { K_SERVICE: "nesafric-web" })).toEqual({ ip: "41.66.1.10", source: "cloud-run" });
    expect(resolveClientIdentity(headers({}), { K_SERVICE: "nesafric-web" })).toEqual({ ip: null, source: "none" });
  });

  it("on Cloud Run behind a Google load balancer takes the entry before the balancer's own", () => {
    const request = headers({ "x-forwarded-for": "6.6.6.6, 41.66.1.10, 34.120.1.1" });
    expect(resolveClientIdentity(request, { K_SERVICE: "nesafric-web", CLOUD_RUN_BEHIND_LOAD_BALANCER: "true" })).toEqual({ ip: "41.66.1.10", source: "cloud-run" });
    expect(resolveClientIdentity(headers({ "x-forwarded-for": "41.66.1.10" }), { K_SERVICE: "nesafric-web", CLOUD_RUN_BEHIND_LOAD_BALANCER: "true" })).toEqual({ ip: null, source: "none" });
  });

  it("on Cloud Run behind Cloudflare uses cf-connecting-ip only when the appended peer is Cloudflare", () => {
    const viaCloudflare = headers({ "x-forwarded-for": "154.160.2.33, 172.67.159.104", "cf-connecting-ip": "154.160.2.33" });
    expect(resolveClientIdentity(viaCloudflare, { K_SERVICE: "nesafric-web", TRUST_CLOUDFLARE_CLIENT_IP: "true" })).toEqual({ ip: "154.160.2.33", source: "cloudflare" });
    const direct = headers({ "x-forwarded-for": "41.66.1.10", "cf-connecting-ip": "9.9.9.9" });
    expect(resolveClientIdentity(direct, { K_SERVICE: "nesafric-web", TRUST_CLOUDFLARE_CLIENT_IP: "true" })).toEqual({ ip: "41.66.1.10", source: "cloud-run" });
  });

  it("matches Cloudflare ranges for IPv4 and IPv6, and allows overriding them", () => {
    expect(isCloudflareIp("104.21.58.116", {})).toBe(true);
    expect(isCloudflareIp("2606:4700:3030::ac43:9f68", {})).toBe(true);
    expect(isCloudflareIp("41.66.1.10", {})).toBe(false);
    expect(isCloudflareIp("41.66.1.10", { CLOUDFLARE_IP_RANGES: "41.66.0.0/16" })).toBe(true);
  });

  it("groups IPv6 addresses by /64 and keeps IPv4 as-is", () => {
    expect(ipRateLimitKey("2c0f:2a80:10:1::5")).toBe("2c0f:2a80:10:1::/64");
    expect(ipRateLimitKey("2c0f:2a80:10:1:ffff:1:2:3")).toBe("2c0f:2a80:10:1::/64");
    expect(ipRateLimitKey("41.66.1.10")).toBe("41.66.1.10");
    expect(ipRateLimitKey(null)).toBe("unknown");
  });
});
