import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { PrismaClient } from "@/platform/database/generated/client";
import { PrismaPgWithTransactionRelease } from "@/platform/database/pg-adapter";

/*
 * An interactive transaction whose backend is killed (database restart, failover, idle killer,
 * `pg_terminate_backend`). Each case uses its own client and pool so the pool's counters can be read.
 */
type Pool = { totalCount: number; idleCount: number };

/** A client on its own pool of `max` connections, with that pool exposed once connected. */
function observedClient(Adapter: typeof PrismaPg, max: number) {
  const pools: Pool[] = [];
  class Observed extends Adapter {
    async connect() {
      const adapter = await super.connect();
      pools.push(adapter.underlyingDriver() as Pool);
      return adapter;
    }
  }
  const client = new PrismaClient({ adapter: new Observed({ connectionString: process.env.DATABASE_URL, max }) });
  return { client, pool: () => pools[0] };
}
// Which of these surfaces depends on whether pg has seen the socket close before the next query.
const DEAD_CONNECTION = /ConnectionClosed|terminat|not queryable/i;

async function killedTransaction(Adapter: typeof PrismaPg) {
  const { client, pool } = observedClient(Adapter, 2);
  const outcome = client.$transaction(async (tx) => {
    const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
    await db.$queryRaw`SELECT pg_terminate_backend(${pid}::int)`;
    await tx.$queryRaw`SELECT 1`;
  });
  const error = await outcome.then(() => null, (caught: unknown) => caught);
  // Plain queries still work afterwards, on a fresh connection.
  await client.$queryRaw`SELECT 1`;
  return { client, pool: pool(), error };
}

/** Resolves true if the promise settles within the time limit, false otherwise. */
function settlesWithin(promise: Promise<unknown>, ms: number) {
  return Promise.race([promise.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms).unref())]);
}

describe("@prisma/adapter-pg with a killed interactive-transaction backend", () => {
  afterAll(async () => { await db.$disconnect(); });

  // Documents the upstream bug this repository works around. When this case starts failing,
  // Prisma releases the client itself (fixed in 7.0.0) and PrismaPgWithTransactionRelease can go.
  it("plain PrismaPg (6.19) never returns the dead client to the pool", async () => {
    const { client, pool, error } = await killedTransaction(PrismaPg);
    expect(String(error)).toMatch(DEAD_CONNECTION);
    // Two clients: the leaked dead one, still checked out, and the idle one used afterwards.
    expect(pool.totalCount - pool.idleCount).toBe(1);
    expect(await settlesWithin(client.$disconnect(), 1_000)).toBe(false);
  });

  it("PrismaPgWithTransactionRelease returns the dead client, so the pool and $disconnect recover", async () => {
    const { client, pool, error } = await killedTransaction(PrismaPgWithTransactionRelease);
    expect(String(error)).toMatch(DEAD_CONNECTION);
    expect(pool.totalCount - pool.idleCount).toBe(0);
    expect(await settlesWithin(client.$disconnect(), 5_000)).toBe(true);
    expect(pool.totalCount).toBe(0);
  });

  it("PrismaPgWithTransactionRelease leaves normal commits and rollbacks unchanged", async () => {
    const { client, pool } = observedClient(PrismaPgWithTransactionRelease, 1);
    for (let i = 0; i < 3; i++) {
      expect(await client.$transaction(async (tx) => (await tx.$queryRaw<Array<{ n: number }>>`SELECT 1::int AS n`)[0].n)).toBe(1);
      await expect(client.$transaction(async () => { throw new Error("abort"); })).rejects.toThrow("abort");
    }
    // max: 1, so a single leaked client would have blocked the loop above.
    expect(pool().totalCount).toBe(1);
    expect(pool().idleCount).toBe(1);
    expect(await settlesWithin(client.$disconnect(), 5_000)).toBe(true);
  });
});
