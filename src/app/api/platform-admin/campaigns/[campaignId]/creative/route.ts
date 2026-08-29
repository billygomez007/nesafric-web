import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";
import { uploadCampaignCreative } from "@/modules/documents/service";
import { removeCampaignCreative } from "@/modules/campaigns/service";

/** Platform-admin-only campaign creative upload (Phase 24) — `requirePlatformPrincipal` here is
 * the actual authorization gate; the `CAMPAIGN_CREATIVE` upload target's own `authorize` step
 * re-checks the same thing server-side (defense in depth, matches every other upload target). */
export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  try {
    const user = await requireUser();
    await requirePlatformPrincipal(user);
    return NextResponse.json(
      await uploadCampaignCreative(user.id, (await params).campaignId, await request.json()),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    const slot = new URL(request.url).searchParams.get("slot") === "mobile" ? "mobile" : "desktop";
    return NextResponse.json(await removeCampaignCreative(principal, (await params).campaignId, slot));
  } catch (error) {
    return errorResponse(error);
  }
}
