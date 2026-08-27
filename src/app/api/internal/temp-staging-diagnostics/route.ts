import { NextResponse } from "next/server";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";

/**
 * TEMPORARY, throwaway diagnostic/seed route for the staging Campaign-visibility investigation.
 * Never runs outside a Vercel Preview deployment, and only responds to a secret this route's own
 * author holds — not committed anywhere, not derived from DATABASE_URL/SESSION_SECRET. Delete this
 * file (and the STAGING_DIAG_SECRET Preview env var) once the staging banner diagnosis is done.
 */
function guard(request: Request) {
  if (process.env.VERCEL_ENV !== "preview") return false;
  const expected = process.env.STAGING_DIAG_SECRET;
  if (!expected) return false;
  const header = request.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

const SAFE_FIELDS = {
  id: true,
  name: true,
  status: true,
  placement: true,
  priority: true,
  startAt: true,
  endAt: true,
  countryCode: true,
  isPlatformOwned: true,
  archivedAt: true,
  impressionCount: true,
  clickCount: true,
} as const;

export async function GET(request: Request) {
  if (!guard(request)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const [campaigns, userCount, principalCount] = await Promise.all([
    db.campaign.findMany({ select: SAFE_FIELDS, orderBy: [{ placement: "asc" }, { priority: "desc" }] }),
    db.user.count(),
    db.platformPrincipal.count(),
  ]);
  return NextResponse.json({ campaignCount: campaigns.length, campaigns, userCount, platformPrincipalCount: principalCount });
}

const DEMO_PASSWORD = "StagingDiag123!";
const ADMIN_EMAIL = "staging-diag-admin@umoafric-staging.demo";
const LANDLORD_EMAIL = "staging-diag-landlord@umoafric-staging.demo";

async function findOrCreateUser(email: string, displayName: string) {
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return existing;
  return registerUser({ email, displayName, password: DEMO_PASSWORD });
}

export async function POST(request: Request) {
  if (!guard(request)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const origin = new URL(request.url).origin;
  const admin = await findOrCreateUser(ADMIN_EMAIL, "Staging Diagnostics Admin");
  const landlord = await findOrCreateUser(LANDLORD_EMAIL, "Staging Diagnostics Landlord");

  await db.platformPrincipal.upsert({
    where: { userId: admin.id },
    update: { role: "SUPER_ADMIN", status: "ACTIVE" },
    create: { userId: admin.id, role: "SUPER_ADMIN", status: "ACTIVE", createdVia: "MANUAL" },
  });

  const campaignDefaults = {
    isPlatformOwned: true,
    createdByUserId: admin.id,
    reviewedByUserId: admin.id,
    reviewedAt: new Date(),
    countryCode: "GH",
  } as const;

  const existingEligible = await db.campaign.findMany({
    where: { placement: { in: ["MARKETPLACE_PRIMARY", "MARKETPLACE_INLINE"] } },
    select: { id: true, placement: true },
  });

  const created: string[] = [];
  const hasPrimary = existingEligible.some((c) => c.placement === "MARKETPLACE_PRIMARY");
  const inlineCount = existingEligible.filter((c) => c.placement === "MARKETPLACE_INLINE").length;

  if (!hasPrimary) {
    await db.campaign.create({
      data: {
        ...campaignDefaults,
        name: "Umo Afric — Marketplace primary hero (Staging Demo)",
        placement: "MARKETPLACE_PRIMARY",
        status: "ACTIVE",
        priority: 100,
        headline: "Discover Ghana's most trusted property marketplace",
        supportingText: "Verified listings, vetted professionals, and secure transactions — all in one place.",
        ctaLabel: "Explore listings",
        destinationUrl: `${origin}/marketplace/properties`,
        desktopMediaUrl: "https://placehold.co/1600x700/052e28/052e28/png",
        mobileMediaUrl: "https://placehold.co/900x900/052e28/052e28/png",
      },
    });
    created.push("MARKETPLACE_PRIMARY hero");
  }

  const inlineSeeds = [
    {
      name: "Umo Afric Professionals — join the marketplace (Staging Demo)",
      priority: 30,
      headline: "List with a verified professional profile",
      supportingText: "Agents, brokers and brokerages — reach more clients on the Umo Afric Marketplace.",
      ctaLabel: "View professionals",
      destinationUrl: `${origin}/marketplace/professionals`,
    },
    {
      name: "Umo Afric Developers — featured developments (Staging Demo)",
      priority: 20,
      headline: "Showcase your development to serious buyers",
      supportingText: "Unit-level inventory, pricing and sales pipeline — built for developers.",
      ctaLabel: "Learn more",
      destinationUrl: `${origin}/for-developers`,
    },
    {
      name: "Umo Afric — browse all properties (Staging Demo)",
      priority: 10,
      headline: "New listings added every week",
      supportingText: "Browse verified properties for rent and sale across Ghana.",
      ctaLabel: "Browse properties",
      destinationUrl: `${origin}/marketplace/properties`,
    },
  ];

  for (const seed of inlineSeeds.slice(0, Math.max(0, 3 - inlineCount))) {
    await db.campaign.create({
      data: {
        ...campaignDefaults,
        placement: "MARKETPLACE_INLINE",
        status: "ACTIVE",
        desktopMediaUrl: "https://placehold.co/1200x600/0f172a/0f172a/png",
        mobileMediaUrl: null,
        ...seed,
      },
    });
    created.push(`MARKETPLACE_INLINE: ${seed.name}`);
  }

  return NextResponse.json({
    created,
    adminEmail: admin.email,
    landlordEmail: landlord.email,
    demoPassword: DEMO_PASSWORD,
  });
}
