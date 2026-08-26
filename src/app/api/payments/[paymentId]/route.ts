import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";
import { getPayment } from "@/modules/payments/service";

export async function GET(request: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  try {
    return NextResponse.json(await getPayment((await requireUser()).id, requireOrganisationId(request), (await params).paymentId));
  } catch (error) {
    return errorResponse(error);
  }
}
