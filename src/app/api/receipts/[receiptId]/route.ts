import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";
import { getReceipt } from "@/modules/payments/service";

export async function GET(request: Request, { params }: { params: Promise<{ receiptId: string }> }) {
  try {
    return NextResponse.json(await getReceipt((await requireUser()).id, requireOrganisationId(request), (await params).receiptId));
  } catch (error) {
    return errorResponse(error);
  }
}
