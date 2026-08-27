import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { createDevelopment, listDevelopments } from "@/modules/developments/service";

type Context = { params: Promise<{ professionalId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const { professionalId } = await params;
    const user = await requireUser();
    const development = await createDevelopment(user.id, professionalId, await request.json());
    return NextResponse.json(development, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(_request: Request, { params }: Context) {
  try {
    const { professionalId } = await params;
    const user = await requireUser();
    return NextResponse.json(await listDevelopments(user.id, professionalId));
  } catch (error) {
    return errorResponse(error);
  }
}
