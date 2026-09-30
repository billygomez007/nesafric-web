import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("provider document upload failure UX", () => {
  const onboarding = readFileSync(
    "src/components/service-provider-onboarding-form.tsx",
    "utf8",
  );

  const envExample = readFileSync(".env.example", "utf8");

  it("does not expose storage configuration failures directly to providers", () => {
    expect(onboarding).toContain('"STORAGE_NOT_CONFIGURED"');
    expect(onboarding).toContain('"STORAGE_PRIVATE_NOT_CONFIGURED"');
    expect(onboarding).toContain('"STORAGE_PUBLIC_NOT_CONFIGURED"');
    expect(onboarding).toContain(
      '"Document upload is temporarily unavailable. Please try again later."',
    );
  });

  it("documents explicit private and public S3 buckets for cloud deployments", () => {
    expect(envExample).toContain('STORAGE_S3_PRIVATE_BUCKET=""');
    expect(envExample).toContain('STORAGE_S3_PUBLIC_BUCKET=""');
  });
});
