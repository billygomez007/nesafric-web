import { NextResponse } from "next/server";
import { createSession } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { registerUser } from "@/modules/identity/service";

export async function POST(request: Request) {
  try {
    const user = await registerUser(await request.json());
    await createSession(user.id);
    return NextResponse.json({ id: user.id, email: user.email, displayName: user.displayName }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
