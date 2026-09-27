import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  generateTenantAccessCode,
  hashTenantAccessCode,
} from "@/modules/tenants/access-invitations";

const ORIGINAL_SECRET = process.env.SESSION_SECRET;

describe("tenant access invitation security", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = "tenant-access-unit-test-secret";
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) {
      delete process.env.SESSION_SECRET;
    } else {
      process.env.SESSION_SECRET = ORIGINAL_SECRET;
    }
  });

  it("generates a human-readable high-entropy code without ambiguous characters", () => {
    const code = generateTenantAccessCode();

    expect(code).toMatch(
      /^NT-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}(?:-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}){3}$/,
    );

    expect(code).not.toMatch(/[01IO]/);
  });

  it("generates different codes", () => {
    const codes = new Set(
      Array.from({ length: 100 }, () => generateTenantAccessCode()),
    );

    expect(codes.size).toBe(100);
  });

  it("hashes the same normalized code consistently", () => {
    const code = "NT-ABCDE-FGHJK-LMNPQ-RSTUV";

    expect(hashTenantAccessCode(code)).toBe(
      hashTenantAccessCode(" nt abcde fghjk lmnpq rstuv "),
    );
  });

  it("does not use the raw code as the persisted lookup value", () => {
    const code = "NT-ABCDE-FGHJK-LMNPQ-RSTUV";
    const hash = hashTenantAccessCode(code);

    expect(hash).not.toBe(code);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain("ABCDE");
  });

  it("produces different hashes for different codes", () => {
    expect(
      hashTenantAccessCode("NT-ABCDE-FGHJK-LMNPQ-RSTUV"),
    ).not.toBe(
      hashTenantAccessCode("NT-ABCDE-FGHJK-LMNPQ-RSTUW"),
    );
  });

  it("fails closed when the hashing secret is unavailable", () => {
    delete process.env.SESSION_SECRET;

    expect(() =>
      hashTenantAccessCode("NT-ABCDE-FGHJK-LMNPQ-RSTUV"),
    ).toThrow(/SESSION_SECRET/);
  });
});
