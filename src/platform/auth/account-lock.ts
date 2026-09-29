import { db } from "@/platform/database/client";
import type { Prisma } from "@/platform/database/generated/client";
import type { AppError } from "@/platform/errors";

/**
 * ACCOUNT CONCURRENCY MODEL (security batch 1).
 *
 * Who may sign in to an account, and how, is decided by five fields of its `User` row: the
 * password hash, the email and whether it is verified, the phone and whether it is verified. Work
 * that was authenticated against those fields — a password sign-in, a password change, linking or
 * changing an email or phone — takes time (password hashing, SMS provider checks) and may still be
 * running when the account changes underneath it, most importantly when the real owner of a
 * squatted email proves it (`claimEmailOnFirstProof`).
 *
 * 1. The `User` row is the single serialization authority. Every one of these transitions locks it
 *    with `SELECT … FOR UPDATE` as the FIRST statement of its transaction, and locks no other
 *    `User` row, so there is one lock order and no deadlock between them.
 * 2. Before committing, in-flight work compares the locked row with the `AccountState` it
 *    authenticated against, and, where it runs on a signed-in session, checks that session still
 *    exists. Any difference means the account changed hands or identity meanwhile: the work is
 *    stale and fails, changing nothing.
 * 3. Sessions are only created (sign-in, password change) and revoked (first proof, password
 *    change, email change) inside such a locked transaction, so a revocation and a stale creation
 *    can never interleave: whichever commits second sees the other's result.
 * 4. The first proof of a squatted email changes every one of these fields' meaning (verified,
 *    password and phone cleared) and deletes every session, so anything authenticated before it —
 *    its state or its session — is stale afterwards and cannot recreate access.
 */
export type AccountState = {
  passwordHash: string | null;
  email: string | null;
  emailVerifiedAt: Date | null;
  phoneE164: string | null;
  phoneVerifiedAt: Date | null;
};

type Tx = Prisma.TransactionClient;

export function accountState(user: AccountState): AccountState {
  return {
    passwordHash: user.passwordHash,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt,
    phoneE164: user.phoneE164,
    phoneVerifiedAt: user.phoneVerifiedAt,
  };
}

const time = (value: Date | null) => (value ? value.getTime() : null);

function sameState(a: AccountState, b: AccountState) {
  return (
    a.passwordHash === b.passwordHash &&
    (a.email ?? null)?.toLowerCase() === (b.email ?? null)?.toLowerCase() &&
    time(a.emailVerifiedAt) === time(b.emailVerifiedAt) &&
    a.phoneE164 === b.phoneE164 &&
    time(a.phoneVerifiedAt) === time(b.phoneVerifiedAt)
  );
}

/** Locks the user row for the rest of the transaction and returns its current sign-in state. */
export async function lockAccount(tx: Tx, userId: string): Promise<AccountState | null> {
  const [row] = await tx.$queryRaw<AccountState[]>`
    SELECT "passwordHash", "email"::text AS "email", "emailVerifiedAt", "phoneE164", "phoneVerifiedAt"
    FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
  return row ?? null;
}

/**
 * Runs `work` under the account lock, only if the account is still exactly `expected` and — when
 * `sessionTokenHash` is given — the caller's session still exists. Otherwise throws `stale()` and
 * nothing is written.
 */
export async function withAccountUnchanged<T>(
  userId: string,
  expected: AccountState,
  options: { sessionTokenHash?: string | null; stale: () => AppError },
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    const current = await lockAccount(tx, userId);
    if (!current || !sameState(current, expected)) throw options.stale();
    if (options.sessionTokenHash !== undefined) {
      const alive = options.sessionTokenHash
        ? await tx.session.count({ where: { userId, tokenHash: options.sessionTokenHash, expiresAt: { gt: new Date() } } })
        : 0;
      if (alive !== 1) throw options.stale();
    }
    return work(tx);
  });
}
