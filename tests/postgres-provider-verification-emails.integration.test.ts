import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createServiceProvider, reviewProviderEvidence, reviewProviderIdentity, submitProviderVerification, addProviderToDirectory } from "@/modules/providers/service";
import { jobHandlers } from "@/platform/jobs/handlers";
import { runDueJobs } from "@/platform/jobs/runner";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation" CASCADE');
}

async function platformAdmin(email: string) {
  const user = await registerUser({ displayName: "Identity Reviewer", email, password: "secure-password-123" });
  await db.platformPrincipal.create({ data: { userId: user.id, role: "SUPER_ADMIN", status: "ACTIVE", createdVia: "MANUAL" } });
  return user;
}

function jobsFor(userId: string, template: string) {
  return db.backgroundJob.findMany({ where: { type: "account-email" }, orderBy: { createdAt: "asc" } }).then((jobs) =>
    jobs.filter((job) => {
      const payload = job.payload as { userId?: string; template?: string };
      return payload.userId === userId && payload.template === template;
    }),
  );
}

describe("PostgreSQL service-professional verification emails", () => {
  beforeEach(cleanDatabase);
  afterAll(cleanDatabase);

  it("queues an onboarding-complete email when a service provider profile is created", async () => {
    const user = await registerUser({ displayName: "Kwabena Osei", email: "kwabena@provider-email.test", password: "secure-password-123" });
    const provider = await createServiceProvider(user.id, { type: "INDIVIDUAL", displayName: "Kwabena Plumbing", contactEmail: "kwabena@provider-email.test" });
    const jobs = await jobsFor(user.id, "ONBOARDING_COMPLETE_SERVICES");
    expect(jobs).toHaveLength(1);
    expect((jobs[0].payload as { workspaceName?: string }).workspaceName).toBe(provider.displayName);
  });

  it("queues a submitted-verification email addressed to the provider's administrator, and delivers it", async () => {
    const user = await registerUser({ displayName: "Ama Serwaa", email: "ama@provider-email.test", password: "secure-password-123" });
    const provider = await createServiceProvider(user.id, { type: "INDIVIDUAL", displayName: "Ama Electrical", contactEmail: "ama@provider-email.test" });
    await submitProviderVerification(user.id, provider.id, {
      evidence: [{ type: "GHANA_CARD_FRONT", reference: "evidence/front" }, { type: "GHANA_CARD_BACK", reference: "evidence/back" }],
    });
    const jobs = await jobsFor(user.id, "PROVIDER_VERIFICATION_SUBMITTED");
    expect(jobs).toHaveLength(1);
    expect((jobs[0].payload as { providerId?: string }).providerId).toBe(provider.id);

    await runDueJobs(jobHandlers);
    const delivered = await db.backgroundJob.findUniqueOrThrow({ where: { id: jobs[0].id } });
    expect(delivered.status).toBe("SUCCEEDED");
  });

  it("sends a distinct submitted-verification email for each real resubmission, never collapsing separate events", async () => {
    const user = await registerUser({ displayName: "Yaw Darko", email: "yaw@provider-email.test", password: "secure-password-123" });
    const provider = await createServiceProvider(user.id, { type: "INDIVIDUAL", displayName: "Yaw Carpentry", contactEmail: "yaw@provider-email.test" });
    await submitProviderVerification(user.id, provider.id, {
      evidence: [{ type: "GHANA_CARD_FRONT", reference: "evidence/front" }, { type: "GHANA_CARD_BACK", reference: "evidence/back" }],
    });
    const reviewer = await platformAdmin("yaw-reviewer@provider-email.test");
    await reviewProviderIdentity(reviewer, provider.id, { status: "REJECTED", reason: "Document image was unreadable." });
    await submitProviderVerification(user.id, provider.id, {
      evidence: [{ type: "GHANA_CARD_FRONT", reference: "evidence/front-2" }, { type: "GHANA_CARD_BACK", reference: "evidence/back-2" }],
    });
    const submittedJobs = await jobsFor(user.id, "PROVIDER_VERIFICATION_SUBMITTED");
    expect(submittedJobs).toHaveLength(2);
    expect(submittedJobs[0].idempotencyKey).not.toBe(submittedJobs[1].idempotencyKey);
  });

  it("queues a more-information-needed email carrying the reviewer's reason", async () => {
    const user = await registerUser({ displayName: "Efo Mensah", email: "efo@provider-email.test", password: "secure-password-123" });
    const provider = await createServiceProvider(user.id, { type: "INDIVIDUAL", displayName: "Efo Roofing", contactEmail: "efo@provider-email.test" });
    await submitProviderVerification(user.id, provider.id, {
      evidence: [{ type: "GHANA_CARD_FRONT", reference: "evidence/front" }, { type: "GHANA_CARD_BACK", reference: "evidence/back" }],
    });
    const reviewer = await platformAdmin("efo-reviewer@provider-email.test");
    await reviewProviderIdentity(reviewer, provider.id, { status: "REQUIRES_MORE_INFORMATION", reason: "Ghana Card photo is blurry." });
    const jobs = await jobsFor(user.id, "PROVIDER_VERIFICATION_MORE_INFO");
    expect(jobs).toHaveLength(1);
    expect((jobs[0].payload as { reason?: string }).reason).toBe("Ghana Card photo is blurry.");
  });

  it("queues an approved email once identity is verified for a directory-less provider", async () => {
    const user = await registerUser({ displayName: "Abena Frimpong", email: "abena@provider-email.test", password: "secure-password-123" });
    const provider = await createServiceProvider(user.id, { type: "INDIVIDUAL", displayName: "Abena Painting", contactEmail: "abena@provider-email.test" });
    await submitProviderVerification(user.id, provider.id, {
      evidence: [{ type: "GHANA_CARD_FRONT", reference: "evidence/front" }, { type: "GHANA_CARD_BACK", reference: "evidence/back" }],
    });
    const reviewer = await platformAdmin("abena-reviewer@provider-email.test");
    const frontEvidence = await db.providerEvidence.findFirstOrThrow({ where: { providerId: provider.id, type: "GHANA_CARD_FRONT" } });
    const backEvidence = await db.providerEvidence.findFirstOrThrow({ where: { providerId: provider.id, type: "GHANA_CARD_BACK" } });
    await reviewProviderEvidence(reviewer, frontEvidence.id, { status: "APPROVED" });
    await reviewProviderEvidence(reviewer, backEvidence.id, { status: "APPROVED" });
    await reviewProviderIdentity(reviewer, provider.id, { status: "VERIFIED" });
    const jobs = await jobsFor(user.id, "PROVIDER_VERIFICATION_APPROVED");
    expect(jobs).toHaveLength(1);
  });

  it("does NOT send an approved email when the VERIFIED identity decision is deferred to an active landlord directory", async () => {
    const providerUser = await registerUser({ displayName: "Nana Yeboah", email: "nana@provider-email.test", password: "secure-password-123" });
    const provider = await createServiceProvider(providerUser.id, { type: "INDIVIDUAL", displayName: "Nana Tiling", contactEmail: "nana@provider-email.test" });
    const landlordUser = await registerUser({ displayName: "Landlord Owner", email: "landlord@provider-email.test", password: "secure-password-123" });
    const organisation = await createOrganisation(landlordUser.id, { name: "Accra Estates", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await addProviderToDirectory(landlordUser.id, organisation.id, { providerId: provider.id });

    await submitProviderVerification(providerUser.id, provider.id, {
      evidence: [{ type: "GHANA_CARD_FRONT", reference: "evidence/front" }, { type: "GHANA_CARD_BACK", reference: "evidence/back" }],
    });
    const reviewer = await platformAdmin("nana-reviewer@provider-email.test");
    const frontEvidence = await db.providerEvidence.findFirstOrThrow({ where: { providerId: provider.id, type: "GHANA_CARD_FRONT" } });
    const backEvidence = await db.providerEvidence.findFirstOrThrow({ where: { providerId: provider.id, type: "GHANA_CARD_BACK" } });
    await reviewProviderEvidence(reviewer, frontEvidence.id, { status: "APPROVED" });
    await reviewProviderEvidence(reviewer, backEvidence.id, { status: "APPROVED" });
    const updated = await reviewProviderIdentity(reviewer, provider.id, { status: "VERIFIED" });

    // The identity check passed, but this provider has an active landlord directory relationship,
    // so verificationStatus is deliberately left for that landlord's own review — nothing
    // customer-visible changed yet, so no "you're verified" email should exist.
    expect(updated.verificationStatus).not.toBe("VERIFIED");
    const jobs = await jobsFor(providerUser.id, "PROVIDER_VERIFICATION_APPROVED");
    expect(jobs).toHaveLength(0);
  });

  it("queues a rejected email with a respectful, neutral reason and no internal jargon", async () => {
    const user = await registerUser({ displayName: "Kofi Antwi", email: "kofi@provider-email.test", password: "secure-password-123" });
    const provider = await createServiceProvider(user.id, { type: "INDIVIDUAL", displayName: "Kofi Welding", contactEmail: "kofi@provider-email.test" });
    await submitProviderVerification(user.id, provider.id, {
      evidence: [{ type: "GHANA_CARD_FRONT", reference: "evidence/front" }, { type: "GHANA_CARD_BACK", reference: "evidence/back" }],
    });
    const reviewer = await platformAdmin("kofi-reviewer@provider-email.test");
    await reviewProviderIdentity(reviewer, provider.id, { status: "REJECTED", reason: "Card details did not match the profile name." });
    const jobs = await jobsFor(user.id, "PROVIDER_VERIFICATION_REJECTED");
    expect(jobs).toHaveLength(1);
    expect((jobs[0].payload as { reason?: string }).reason).toBe("Card details did not match the profile name.");
  });
});
