import { NextResponse } from "next/server";
import { z } from "zod";

import { redeemTenantAccessCode } from "@/modules/tenants/access-invitations";
import { requireUser } from "@/platform/auth/session";
import {
  reserveTenantAccessAttempt,
  tenantAccessErrorResponse,
} from "@/platform/security/tenant-access-rate-limit";

const schema = z.object({
  code: z.string().trim().min(8).max(80),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = schema.parse(await request.json());

    await reserveTenantAccessAttempt(request.headers, user.id);

    return NextResponse.json(
      await redeemTenantAccessCode(user.id, body.code),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return tenantAccessErrorResponse(error);
  }
}
