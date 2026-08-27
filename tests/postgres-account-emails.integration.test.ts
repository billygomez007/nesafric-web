import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createMarketplaceProfessional } from "@/modules/marketplace-professionals/service";
import { enqueueWelcomeEmail } from "@/modules/account-emails/service";
import { db } from "@/platform/database/client";
import { jobHandlers } from "@/platform/jobs/handlers";
import { runDueJobs } from "@/platform/jobs/runner";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation" CASCADE');
}

describe("PostgreSQL account emails (welcome + onboarding completion)", () => {
  beforeEach(cleanDatabase);
  afterAll(cleanDatabase);

  it("queues exactly one welcome email job on registration, even if called again (idempotent)", async () => {
    const user = await registerUser({ displayName: "Ama Boateng", email: "ama@account-email.test", password: "secure-password-123" });
    const jobsAfterRegister = await db.backgroundJob.findMany({ where: { type: "account-email" } });
    expect(jobsAfterRegister).toHaveLength(1);
    expect(jobsAfterRegister[0].idempotencyKey).toBe(`account-email:welcome:${user.id}`);

    // Simulates a retried registration callback / duplicate enqueue attempt.
    await enqueueWelcomeEmail(user.id);
    await enqueueWelcomeEmail(user.id);
    const jobsAfterRetries = await db.backgroundJob.findMany({ where: { type: "account-email" } });
    expect(jobsAfterRetries).toHaveLength(1);
  });

  it("delivers the welcome email to the registering user's own address, and only once even after the job is reprocessed", async () => {
    const user = await registerUser({ displayName: "Kwame Owusu", email: "kwame@account-email.test", password: "secure-password-123" });
    await runDueJobs(jobHandlers);
    const job = await db.backgroundJob.findFirstOrThrow({ where: { idempotencyKey: `account-email:welcome:${user.id}` } });
    expect(job.status).toBe("SUCCEEDED");

    // Re-running the due-jobs sweep must not redeliver a SUCCEEDED job.
    await runDueJobs(jobHandlers);
    const stillOne = await db.backgroundJob.count({ where: { idempotencyKey: `account-email:welcome:${user.id}` } });
    expect(stillOne).toBe(1);
  });

  it("queues a PropertyOS onboarding-completion email when a real organisation is created", async () => {
    const user = await registerUser({ displayName: "Adjoa Mensah", email: "adjoa@account-email.test", password: "secure-password-123" });
    await createOrganisation(user.id, { name: "Golden Coast Properties", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const job = await db.backgroundJob.findFirst({ where: { idempotencyKey: `account-email:ONBOARDING_COMPLETE_PROPERTYOS:${user.id}` } });
    expect(job).not.toBeNull();
    expect((job?.payload as { workspaceName?: string } | null)?.workspaceName).toBe("Golden Coast Properties");
  });

  it("does NOT send a PropertyOS onboarding email for the hidden technical-backing organisation created alongside a marketplace profile", async () => {
    const user = await registerUser({ displayName: "Kojo Asante", email: "kojo@account-email.test", password: "secure-password-123" });
    await createMarketplaceProfessional(user.id, {
      type: "INDIVIDUAL_AGENT",
      displayName: "Kojo Realty",
      legalName: "Kojo Realty Ltd",
      countryCode: "GH",
    });
    const propertyOsJob = await db.backgroundJob.findFirst({ where: { idempotencyKey: `account-email:ONBOARDING_COMPLETE_PROPERTYOS:${user.id}` } });
    expect(propertyOsJob).toBeNull();
    const marketplaceJob = await db.backgroundJob.findFirst({ where: { idempotencyKey: `account-email:ONBOARDING_COMPLETE_MARKETPLACE:${user.id}` } });
    expect(marketplaceJob).not.toBeNull();
    expect((marketplaceJob?.payload as { workspaceName?: string } | null)?.workspaceName).toBe("Kojo Realty");
  });

  it("keeps account-email jobs unscoped to any single organisation (no organisationId on the job row)", async () => {
    const user = await registerUser({ displayName: "Efua Danso", email: "efua@account-email.test", password: "secure-password-123" });
    const job = await db.backgroundJob.findFirstOrThrow({ where: { idempotencyKey: `account-email:welcome:${user.id}` } });
    expect(job.organisationId).toBeNull();
  });
});
