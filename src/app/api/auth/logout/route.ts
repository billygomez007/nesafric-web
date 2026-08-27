import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { destroySession } from "@/platform/auth/session";

export async function POST() {
  await destroySession();
  const store = await cookies();
  store.delete("propertyos_session");
  return new NextResponse(null, { status: 204 });
}
