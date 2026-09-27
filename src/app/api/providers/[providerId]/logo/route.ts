import { NextResponse } from "next/server";
import { removeServiceProviderLogo, uploadServiceProviderLogo } from "@/modules/documents/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

type Context = { params: Promise<{ providerId: string }> };

/** Provider self-service logo upload/replace: `{ fileName, contentType, dataBase64 }`. The
 * provider's owner only (same `ownsProvider` rule as verification evidence). Stored as a PUBLIC
 * `StorageObject` and linked through `ServiceProvider.logoStorageObjectId`. */
export async function POST(request: Request, { params }: Context) {
  try {
    const { providerId } = await params;
    const user = await requireUser();
    return NextResponse.json(await uploadServiceProviderLogo(user.id, providerId, await request.json()), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const { providerId } = await params;
    const user = await requireUser();
    return NextResponse.json(await removeServiceProviderLogo(user.id, providerId));
  } catch (error) {
    return errorResponse(error);
  }
}
