import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { registerUser } from "@/modules/identity/service";
import { assertLoginNotRateLimited } from "@/platform/auth/rate-limit";
import { db } from "@/platform/database/client";

async function cleanDatabase() {
  await db.loginAttempt.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany();
}

function loginRequest(email: string, password: string) {
  return new Request("https://example.test/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

describe("Login rate limiting (production-hardening security audit item 2)", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("locks out an email after repeated failed attempts, independent of successful logins for other accounts", async () => {
    await registerUser({ displayName: "Target User", email: "target@ratelimit.test", password: "correct-password-123" });
    await registerUser({ displayName: "Other User", email: "other@ratelimit.test", password: "correct-password-123" });

    for (let attempt = 0; attempt < 8; attempt++) {
      const response = await loginRoute(loginRequest("target@ratelimit.test", "wrong-password"));
      expect(response.status).toBe(401);
    }

    // The 9th attempt against the same email is rate-limited even with the correct password now.
    const limited = await loginRoute(loginRequest("target@ratelimit.test", "correct-password-123"));
    expect(limited.status).toBe(429);
    expect((await limited.json()).error.code).toBe("LOGIN_RATE_LIMITED");

    // A different email is unaffected by the target email's lockout.
    await expect(assertLoginNotRateLimited("other@ratelimit.test")).resolves.toBeUndefined();
  });
});
