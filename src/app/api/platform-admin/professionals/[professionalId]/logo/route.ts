import { NextResponse } from "next/server";
import {
  removeMarketplaceProfessionalLogoAsPlatform,
  uploadMarketplaceProfessionalLogoAsPlatform,
} from "@/modules/documents/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { PLATFORM_PERMISSIONS, requirePlatformPrincipal } from "@/platform/platform-admin/auth";

type Context = { params: Promise<{ professionalId: string }> };

/** Platform-admin logo upload/replace for a marketplace company. Writes the same
 * `MarketplaceProfessional.logoUrl` the business edits; requires `marketplaceVerify`. */
export async function POST(request: Request, { params }: Context) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser(), PLATFORM_PERMISSIONS.marketplaceVerify);
    const { professionalId } = await params;
    return NextResponse.json(
      await uploadMarketplaceProfessionalLogoAsPlatform(principal, professionalId, await request.json()),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser(), PLATFORM_PERMISSIONS.marketplaceVerify);
    const { professionalId } = await params;
    return NextResponse.json(await removeMarketplaceProfessionalLogoAsPlatform(principal, professionalId));
  } catch (error) {
    return errorResponse(error);
  }
}
