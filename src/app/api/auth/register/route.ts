import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { registerUser } from "@/modules/identity/service";
import { createSession } from "@/platform/auth/session";
import {
  AUTH_RETURN_TO_COOKIE,
  safeReturnTo,
} from "@/platform/auth/return-to";
import { errorResponse } from "@/platform/errors";

export async function POST(request: Request) {
  try {
    const user = await registerUser(
      await request.json(),
    );

    await createSession(user.id);

    const store = await cookies();

    const returnTo = safeReturnTo(
      store.get(
        AUTH_RETURN_TO_COOKIE,
      )?.value,
    );

    if (returnTo) {
      store.delete(
        AUTH_RETURN_TO_COOKIE,
      );
    }

    return NextResponse.json(
      {
        id: user.id,
        email: user.email,
        displayName:
          user.displayName,
        returnTo,
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
