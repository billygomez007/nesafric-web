import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { removeMarketplaceProfessionalLogo, uploadMarketplaceProfessionalLogo } from "@/modules/documents/service";

type Context = { params: Promise<{ professionalId: string }> };

/** Business self-service logo upload/replace: `{ fileName, contentType, dataBase64 }`. OWNER or
 * ADMIN of this professional only. The stored URL is saved to `MarketplaceProfessional.logoUrl`. */
export async function POST(request: Request, { params }: Context) {
  try {
    const { professionalId } = await params;
    const user = await requireUser();
    return NextResponse.json(await uploadMarketplaceProfessionalLogo(user.id, professionalId, await request.json()), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const { professionalId } = await params;
    const user = await requireUser();
    return NextResponse.json(await removeMarketplaceProfessionalLogo(user.id, professionalId));
  } catch (error) {
    return errorResponse(error);
  }
}
