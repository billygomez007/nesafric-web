import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function POST() {
  const store = await cookies();
  store.delete("propertyos_session");
  return new NextResponse(null, { status: 204 });
}
