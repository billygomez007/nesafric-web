import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";
import { reversePayment } from "@/modules/payments/service";

export async function POST(request: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  try {
    return NextResponse.json(await reversePayment((await requireUser()).id, requireOrganisationId(request), (await params).paymentId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
