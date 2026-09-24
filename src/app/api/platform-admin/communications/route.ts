import { NextResponse } from "next/server";
import { listCommunicationsForPlatform } from "@/modules/platform-admin/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";

export async function GET(request: Request) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    const url = new URL(request.url);

    return NextResponse.json(
      await listCommunicationsForPlatform(principal, {
        search: url.searchParams.get("search") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
        take: Number(url.searchParams.get("take") ?? 50),
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
