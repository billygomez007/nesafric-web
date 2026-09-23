import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;

export type EncryptedInvitationToken = {
  version: 1;
  iv: string;
  ciphertext: string;
  authTag: string;
};

function invitationEncryptionKey() {
  const configured =
    process.env.INVITATION_TOKEN_ENCRYPTION_KEY?.trim();

  if (configured) {
    if (!/^[0-9a-fA-F]{64}$/.test(configured)) {
      throw new Error(
        "INVITATION_TOKEN_ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 bytes).",
      );
    }

    const key = Buffer.from(
      configured,
      "hex",
    );

    if (key.length !== KEY_BYTES) {
      throw new Error(
        "INVITATION_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.",
      );
    }

    return key;
  }

  if (
    process.env.NODE_ENV !==
    "production"
  ) {
    /*
     * Deterministic non-production key:
     * - keeps local/test job retries functional;
     * - never used in production;
     * - prevents plaintext persistence even in development databases.
     *
     * Production intentionally fails closed when the dedicated key is absent.
     */
    return createHash("sha256")
      .update(
        "nesafric-local-invitation-token-encryption-v1",
      )
      .digest();
  }

  throw new Error(
    "INVITATION_TOKEN_ENCRYPTION_KEY is required to deliver team invitations.",
  );
}

function associatedData(
  invitationId: string,
) {
  return Buffer.from(
    `nesafric:team-invitation:${invitationId}:v1`,
    "utf8",
  );
}

export function encryptInvitationToken(
  rawToken: string,
  invitationId: string,
): EncryptedInvitationToken {
  if (!rawToken) {
    throw new Error(
      "Invitation token cannot be empty.",
    );
  }

  if (!invitationId) {
    throw new Error(
      "Invitation id is required for token encryption.",
    );
  }

  const iv =
    randomBytes(IV_BYTES);

  const cipher = createCipheriv(
    ALGORITHM,
    invitationEncryptionKey(),
    iv,
  );

  cipher.setAAD(
    associatedData(invitationId),
  );

  const ciphertext = Buffer.concat([
    cipher.update(
      rawToken,
      "utf8",
    ),
    cipher.final(),
  ]);

  const authTag =
    cipher.getAuthTag();

  return {
    version: 1,
    iv: iv.toString("base64url"),
    ciphertext:
      ciphertext.toString(
        "base64url",
      ),
    authTag:
      authTag.toString(
        "base64url",
      ),
  };
}

export function decryptInvitationToken(
  encrypted: EncryptedInvitationToken,
  invitationId: string,
): string {
  if (
    encrypted.version !== 1
  ) {
    throw new Error(
      "Unsupported invitation token encryption version.",
    );
  }

  const decipher =
    createDecipheriv(
      ALGORITHM,
      invitationEncryptionKey(),
      Buffer.from(
        encrypted.iv,
        "base64url",
      ),
    );

  decipher.setAAD(
    associatedData(invitationId),
  );

  decipher.setAuthTag(
    Buffer.from(
      encrypted.authTag,
      "base64url",
    ),
  );

  const plaintext =
    Buffer.concat([
      decipher.update(
        Buffer.from(
          encrypted.ciphertext,
          "base64url",
        ),
      ),
      decipher.final(),
    ]);

  return plaintext.toString(
    "utf8",
  );
}
