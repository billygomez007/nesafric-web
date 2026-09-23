import {
  describe,
  expect,
  it,
} from "vitest";

import {
  decryptInvitationToken,
  encryptInvitationToken,
} from "@/platform/security/invitation-token-crypto";

describe(
  "invitation token encryption",
  () => {
    it(
      "round-trips a token without storing it as plaintext",
      () => {
        const invitationId =
          "7fdc62c0-96e4-46f5-8a81-c46f61ab4134";

        const token =
          "opaque-secret-invitation-token";

        const encrypted =
          encryptInvitationToken(
            token,
            invitationId,
          );

        expect(
          encrypted.version,
        ).toBe(1);

        expect(
          encrypted.ciphertext,
        ).not.toContain(token);

        expect(
          JSON.stringify(encrypted),
        ).not.toContain(token);

        expect(
          decryptInvitationToken(
            encrypted,
            invitationId,
          ),
        ).toBe(token);
      },
    );

    it(
      "binds ciphertext to its invitation id",
      () => {
        const encrypted =
          encryptInvitationToken(
            "opaque-token",
            "invitation-a",
          );

        expect(() =>
          decryptInvitationToken(
            encrypted,
            "invitation-b",
          ),
        ).toThrow();
      },
    );

    it(
      "rejects tampered ciphertext",
      () => {
        const invitationId =
          "invitation-tamper-test";

        const encrypted =
          encryptInvitationToken(
            "opaque-token",
            invitationId,
          );

        const tampered = {
          ...encrypted,
          ciphertext:
            `${encrypted.ciphertext.slice(
              0,
              -1,
            )}${
              encrypted.ciphertext.endsWith(
                "A",
              )
                ? "B"
                : "A"
            }`,
        };

        expect(() =>
          decryptInvitationToken(
            tampered,
            invitationId,
          ),
        ).toThrow();
      },
    );
  },
);
