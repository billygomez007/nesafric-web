import { NextResponse } from "next/server";
import { getProvider, updateServiceProvider } from "@/modules/providers/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { getOrganisationIdHeader } from "@/platform/organisations/request";

type Context = { params: Promise<{ providerId: string }> };

/** Organisation header is optional here (unlike most org-scoped routes) so a self-registered,
 * directory-less provider can load their own dashboard — `getProvider` grants full access to an
 * owner regardless, and rejects a non-owner with no organisation context. */
export async function GET(request: Request, { params }: Context) {
  try {
    return NextResponse.json(
      await getProvider((await requireUser()).id, getOrganisationIdHeader(request), (await params).providerId),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    return NextResponse.json(
      await updateServiceProvider((await requireUser()).id, (await params).providerId, await request.json()),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
