import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { PrismaClient } from "@/platform/database/generated/client";
import { PrismaPgWithTransactionRelease } from "@/platform/database/pg-adapter";

/*
 * Interactive transactions whose backend is killed (database restart, failover, idle killer,
 * `pg_terminate_backend`) or whose COMMIT fails. Each case uses its own client on a small pool so
 * the pool's counters, the clients it hands out and the transaction-closing statements that
 * failed can all be observed.
 */

// Which of these surfaces depends on whether pg has seen the socket close before the next statement.
const DEAD_CONNECTION = /ConnectionClosed|terminat|not queryable|ECONNRESET|EPIPE/i;
const MARKER = "pg-adapter-fault-";

type PoolClient = { release: (err?: Error | boolean) => void };
type Pool = { totalCount: number; idleCount: number; connect: (...args: unknown[]) => Promise<PoolClient> };

/** A client on its own pool of `max` connections, instrumented once Prisma connects it. */
function observedClient(Adapter: typeof PrismaPg, max: number) {
  const state = { pool: null as Pool | null, failedCloses: [] as string[], releases: [] as number[] };
  class Observed extends Adapter {
    async connect() {
      const adapter = await super.connect();
      const pool = adapter.underlyingDriver() as unknown as Pool;
      state.pool = pool;
      // Count releases of every client checked out for a transaction (the promise form of
      // `connect`; `pool.query` uses the callback form and manages its own clients).
      const connect = pool.connect.bind(pool);
      pool.connect = (...args: unknown[]) => {
        if (args.length) return connect(...args);
        return connect().then((client) => {
          const index = state.releases.push(0) - 1;
          const release = client.release;
          client.release = (err) => { state.releases[index] += 1; release.call(client, err); };
          return client;
        });
      };
      // Record which transaction-closing statements failed.
      const startTransaction = adapter.startTransaction.bind(adapter);
      adapter.startTransaction = async (isolationLevel) => {
        const tx = await startTransaction(isolationLevel);
        const executeRaw = tx.executeRaw.bind(tx);
        tx.executeRaw = async (query) => {
          try {
            return await executeRaw(query);
          } catch (error) {
            if (query.sql === "COMMIT" || query.sql === "ROLLBACK") state.failedCloses.push(query.sql);
            throw error;
          }
        };
        return tx;
      };
      return adapter;
    }
  }
  const client = new PrismaClient({ adapter: new Observed({ connectionString: process.env.DATABASE_URL, max }) });
  return { client, state, pool: () => state.pool! };
}

/** Resolves true if the promise settles within the time limit, false otherwise. */
function settlesWithin(promise: Promise<unknown>, ms: number) {
  return Promise.race([promise.then(() => true, () => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms).unref())]);
}

/** Kills one backend of this test's own transactions and waits until it is gone. */
async function terminate(pid: number) {
  await db.$queryRaw`SELECT pg_terminate_backend(${pid}::int) FROM pg_stat_activity WHERE pid = ${pid}::int AND datname = current_database()`;
  for (let i = 0; i < 100; i++) {
    const [{ alive }] = await db.$queryRaw<Array<{ alive: bigint }>>`SELECT count(*) AS alive FROM pg_stat_activity WHERE pid = ${pid}::int`;
    if (Number(alive) === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`backend ${pid} survived pg_terminate_backend`);
}

const businessWrite = (tx: Pick<PrismaClient, "organisation">, name: string) =>
  tx.organisation.create({ data: { name: MARKER + name, type: "OTHER", countryCode: "GH", defaultCurrencyCode: "GHS" } });
const survivingWrites = (name: string) => db.organisation.count({ where: { name: MARKER + name } });

type Interruption = "query" | "commit" | "rollback";

/**
 * Writes, then kills the transaction's backend so that the next statement fails:
 * - query: a further query inside the callback, then Prisma's ROLLBACK;
 * - commit: the callback returns normally, so Prisma's COMMIT;
 * - rollback: the callback throws a business error, so Prisma's ROLLBACK.
 */
async function interrupted(client: PrismaClient, interruption: Interruption, name: string) {
  return client.$transaction(async (tx) => {
    await businessWrite(tx, name);
    const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
    await terminate(pid);
    if (interruption === "query") await tx.$queryRaw`SELECT 1`;
    if (interruption === "rollback") throw new Error("business failure");
  }).then(() => null, (caught: unknown) => caught);
}

describe("@prisma/adapter-pg with a killed or failing interactive-transaction backend", () => {
  beforeAll(() => {
    // These tests kill database backends: only ever against a local, disposable database.
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(`refusing to terminate backends on ${url.hostname}: local test databases only`);
    }
  });
  afterAll(async () => {
    await db.organisation.deleteMany({ where: { name: { startsWith: MARKER } } });
    await db.$disconnect();
  });

  // Documents the upstream bug this repository works around. When these cases start failing,
  // Prisma releases the client itself (fixed in 7.0.0) and PrismaPgWithTransactionRelease can go.
  describe("plain PrismaPg (Prisma 6.19)", () => {
    it("never returns the dead client to the pool, so $disconnect hangs", async () => {
      const { client, pool, state } = observedClient(PrismaPg, 2);
      expect(String(await interrupted(client, "query", "plain-1"))).toMatch(DEAD_CONNECTION);
      await client.$queryRaw`SELECT 1`;
      expect(state.failedCloses).toEqual(["ROLLBACK"]);
      expect(state.releases).toEqual([0]);
      expect(pool().totalCount - pool().idleCount).toBe(1);
      expect(await settlesWithin(client.$disconnect(), 1_000)).toBe(false);
    });

    it("hangs every query once interruptions reach the pool size", async () => {
      const { client, pool } = observedClient(PrismaPg, 2);
      for (const name of ["plain-2", "plain-3"]) await interrupted(client, "query", name);
      expect(pool().totalCount - pool().idleCount).toBe(2);
      expect(await settlesWithin(client.$queryRaw`SELECT 1`, 1_000)).toBe(false);
    });
  });

  describe("PrismaPgWithTransactionRelease", () => {
    it("recovers from repeated interruptions well beyond the pool size", async () => {
      const { client, pool, state } = observedClient(PrismaPgWithTransactionRelease, 2);
      const expectations = {
        query: { error: DEAD_CONNECTION, failedClose: "ROLLBACK" },
        commit: { error: DEAD_CONNECTION, failedClose: "COMMIT" },
        // The caller sees its own error, not the failure of the ROLLBACK that followed it.
        rollback: { error: /^Error: business failure$/, failedClose: "ROLLBACK" },
      };
      const rounds: Interruption[] = ["query", "commit", "rollback", "query", "commit", "rollback", "commit", "rollback"];
      for (const [round, interruption] of rounds.entries()) {
        state.failedCloses.length = 0;
        const name = `killed-${round}`;
        expect(String(await interrupted(client, interruption, name))).toMatch(expectations[interruption].error);
        expect(state.failedCloses).toEqual([expectations[interruption].failedClose]);

        // The dead client was released exactly once and discarded; nothing stays checked out.
        expect(state.releases.every((count) => count === 1)).toBe(true);
        expect(pool().totalCount - pool().idleCount).toBe(0);
        expect(pool().totalCount).toBeLessThanOrEqual(2);
        // The killed transaction's write did not survive.
        expect(await survivingWrites(name)).toBe(0);

        // Queries and transactions work again.
        await client.$queryRaw`SELECT 1`;
        await client.$transaction(async (tx) => businessWrite(tx, `recovered-${round}`));
        expect(await survivingWrites(`recovered-${round}`)).toBe(1);
        expect(pool().totalCount - pool().idleCount).toBe(0);
      }
      expect(state.releases).toHaveLength(rounds.length * 2);
      expect(await settlesWithin(client.$disconnect(), 5_000)).toBe(true);
      expect(pool().totalCount).toBe(0);
    });

    it("returns a live client after a failed COMMIT, idle and outside any transaction", async () => {
      const { client, pool, state } = observedClient(PrismaPgWithTransactionRelease, 1);
      let pid = 0;
      // A deferred unique constraint on a temporary table makes COMMIT itself fail on a healthy
      // connection; Postgres rolls the transaction back, temporary table included.
      const error = await client.$transaction(async (tx) => {
        pid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0].pid;
        await businessWrite(tx, "deferred");
        await tx.$executeRaw`CREATE TEMP TABLE pg_adapter_commit_probe (id int UNIQUE DEFERRABLE INITIALLY DEFERRED) ON COMMIT DROP`;
        await tx.$executeRaw`INSERT INTO pg_adapter_commit_probe VALUES (1), (1)`;
      }).then(() => null, (caught: unknown) => caught);
      expect(String(error)).toMatch(/unique|duplicate|23505/i);
      expect(state.failedCloses).toEqual(["COMMIT"]);
      expect(state.releases).toEqual([1]);
      expect(pool().totalCount).toBe(1);
      expect(pool().idleCount).toBe(1);
      expect(await survivingWrites("deferred")).toBe(0);

      // The same backend is reused (max: 1) and is no longer in a transaction.
      const next = await client.$transaction(async (tx) => {
        const [row] = await tx.$queryRaw<Array<{ pid: number; probe: string | null }>>`SELECT pg_backend_pid() AS pid, to_regclass('pg_temp.pg_adapter_commit_probe')::text AS probe`;
        await businessWrite(tx, "after-deferred");
        return row;
      });
      expect(next).toEqual({ pid, probe: null });
      expect(await survivingWrites("after-deferred")).toBe(1);
      expect(state.releases).toEqual([1, 1]);
      expect(await settlesWithin(client.$disconnect(), 5_000)).toBe(true);
    });

    it("rolls back and releases a transaction that times out", async () => {
      const { client, pool, state } = observedClient(PrismaPgWithTransactionRelease, 1);
      const error = await client.$transaction(async (tx) => {
        await businessWrite(tx, "timed-out");
        await tx.$executeRaw`SELECT pg_sleep(1)`;
        await businessWrite(tx, "timed-out-late");
      }, { timeout: 300 }).then(() => null, (caught: unknown) => caught);
      expect(String(error)).toMatch(/timeout|expired|closed/i);
      expect(state.failedCloses).toEqual([]);
      expect(state.releases).toEqual([1]);
      expect(pool().totalCount - pool().idleCount).toBe(0);
      expect(await survivingWrites("timed-out")).toBe(0);
      expect(await survivingWrites("timed-out-late")).toBe(0);
      await client.$transaction(async (tx) => businessWrite(tx, "after-timeout"));
      expect(await survivingWrites("after-timeout")).toBe(1);
      expect(await settlesWithin(client.$disconnect(), 5_000)).toBe(true);
    });

    it("leaves normal commits and rollbacks unchanged", async () => {
      const { client, pool, state } = observedClient(PrismaPgWithTransactionRelease, 1);
      for (let i = 0; i < 3; i++) {
        await client.$transaction(async (tx) => businessWrite(tx, `committed-${i}`));
        await expect(client.$transaction(async (tx) => {
          await businessWrite(tx, `rolled-back-${i}`);
          throw new Error("abort");
        })).rejects.toThrow("abort");
        expect(await survivingWrites(`committed-${i}`)).toBe(1);
        expect(await survivingWrites(`rolled-back-${i}`)).toBe(0);
      }
      // max: 1, so a single leaked client would have blocked the loop above.
      expect(state.failedCloses).toEqual([]);
      expect(state.releases).toEqual([1, 1, 1, 1, 1, 1]);
      expect(pool().totalCount).toBe(1);
      expect(pool().idleCount).toBe(1);
      expect(await settlesWithin(client.$disconnect(), 5_000)).toBe(true);
    });
  });
});
