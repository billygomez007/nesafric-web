import { PrismaPg } from "@prisma/adapter-pg";

type Adapter = Awaited<ReturnType<PrismaPg["connect"]>>;
type Transaction = Awaited<ReturnType<Adapter["startTransaction"]>>;

/**
 * `PrismaPg` with a backport of the transaction-close fix from Prisma 7.0.0.
 *
 * In Prisma 6.19 the transaction manager closes an interactive transaction by sending
 * `COMMIT`/`ROLLBACK` and only then calling the adapter's `commit()`/`rollback()`, which is what
 * hands the pooled `pg` client back. When that statement fails — the backend was killed
 * (`pg_terminate_backend`, a database restart or failover, an idle-session killer) — the release
 * is skipped: the pool keeps counting the dead client as checked out, so it loses a connection
 * for good and `$disconnect()` (which ends the pool) never resolves. Prisma 7 releases in a
 * `finally`; this does the same from the adapter side. Remove once on Prisma 7.
 */
export class PrismaPgWithTransactionRelease extends PrismaPg {
  async connect(): Promise<Adapter> {
    const adapter = await super.connect();
    const startTransaction = adapter.startTransaction.bind(adapter);
    adapter.startTransaction = async (isolationLevel) => releaseOnFailedClose(await startTransaction(isolationLevel));
    return adapter;
  }
}

function releaseOnFailedClose(tx: Transaction): Transaction {
  // Release at most once: `pg` throws if a client is released twice.
  let released = false;
  const once = (release: () => Promise<void>) => async () => {
    if (released) return;
    released = true;
    await release();
  };
  const commit = once(tx.commit.bind(tx));
  const rollback = once(tx.rollback.bind(tx));
  const executeRaw = tx.executeRaw.bind(tx);
  tx.commit = commit;
  tx.rollback = rollback;
  tx.executeRaw = async (query) => {
    try {
      return await executeRaw(query);
    } catch (error) {
      // Postgres ends the transaction when COMMIT fails, and a client that can no longer run
      // ROLLBACK is dead; either way the pool must get it back. A dead client is discarded by
      // the pool on release because it is no longer queryable.
      if (query.sql === "COMMIT" || query.sql === "ROLLBACK") await rollback();
      throw error;
    }
  };
  return tx;
}
