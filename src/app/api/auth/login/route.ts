import { NextResponse } from "next/server";
import { createSession } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { authenticateUser } from "@/modules/identity/service";

export async function POST(request: Request) {
  try {
    const user = await authenticateUser(await request.json());
    await createSession(user.id);
    return NextResponse.json({ id: user.id, email: user.email, displayName: user.displayName });
  } catch (error) {
    return errorResponse(error);
  }
}
