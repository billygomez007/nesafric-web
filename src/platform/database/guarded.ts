import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma, PrismaClient } from "@/platform/database/generated/client";

/*
 * Guarded work: everything a piece of work does through `db` runs on ONE interactive transaction,
 * the same one that holds the guard's lock. The database then enforces the guard:
 *
 * - the work's writes commit together with the lock, or not at all;
 * - if the transaction ends early (its deadline passes, its connection is lost, the database
 *   restarts), the lock is released *and* the writes are rolled back;
 * - any continuation that is still running afterwards keeps pointing at the dead transaction, so
 *   every further query fails instead of falling back to a fresh connection.
 *
 * Nested `db.$transaction(...)` calls become savepoints, and every single statement runs in its
 * own savepoint, so code that catches a failed query and carries on behaves as it would outside
 * the guard. Statements are serialised on the one connection; a nested transaction is entered by
 * one async chain at a time.
 *
 * Side effects outside the database (SMS, file storage) call `assertGuardedWorkActive()` right
 * before they start; it throws once the transaction is gone.
 */

type Tx = Prisma.TransactionClient;
type GuardState = {
  tx: Tx;
  closed: Error | null;
  tail: Promise<unknown>;
  savepoints: number;
  owner: symbol | null;
  waiters: Array<() => void>;
};
type Store = { state: GuardState; chain: readonly symbol[] };

const storage = new AsyncLocalStorage<Store>();
const RAW = new Set(["$queryRaw", "$executeRaw", "$queryRawUnsafe", "$executeRawUnsafe"]);

export class GuardedWorkClosedError extends Error {
  constructor(cause?: unknown) {
    super("The guarded transaction has ended; this work can no longer write or send.", { cause });
    this.name = "GuardedWorkClosedError";
  }
}

/** One statement at a time on the guard's connection. */
function serialised<T>(state: GuardState, fn: () => Promise<T>): Promise<T> {
  const run = state.tail.then(fn, fn);
  state.tail = run.then(() => undefined, () => undefined);
  return run;
}

const outside = (chain: readonly symbol[], state: GuardState) => state.owner !== null && !chain.includes(state.owner);

async function waitForScope(store: Store) {
  while (outside(store.chain, store.state)) await new Promise<void>((resolve) => store.state.waiters.push(resolve));
}

function wake(state: GuardState) {
  const waiters = state.waiters.splice(0);
  for (const resolve of waiters) resolve();
}

function isClosedError(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : "";
  return code === "P2028" || /Transaction (already )?closed|expired transaction|Connection terminated|terminating connection|ECONNRESET|Server has closed the connection/i.test(message);
}

async function statement<T>(store: Store, op: (tx: Tx) => Promise<T>): Promise<T> {
  for (;;) {
    await waitForScope(store);
    const result = await serialised(store.state, async () => {
      const { state } = store;
      if (outside(store.chain, state)) return { retry: true as const };
      if (state.closed) throw state.closed;
      const name = `guarded_${++state.savepoints}`;
      try {
        await state.tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
      } catch (error) {
        state.closed = new GuardedWorkClosedError(error);
        throw state.closed;
      }
      try {
        const value = await op(state.tx);
        await state.tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
        return { retry: false as const, value };
      } catch (error) {
        if (isClosedError(error)) {
          state.closed = new GuardedWorkClosedError(error);
          throw state.closed;
        }
        await state.tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`).catch(() => undefined);
        await state.tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`).catch(() => undefined);
        throw error;
      }
    });
    if (!result.retry) return result.value;
  }
}

async function nestedTransaction(store: Store, client: unknown, arg: unknown) {
  // Array form: the items are statements already issued through the guarded client.
  if (Array.isArray(arg)) {
    const results: unknown[] = [];
    for (const item of arg) results.push(await item);
    return results;
  }
  const fn = arg as (tx: unknown) => Promise<unknown>;
  const id = Symbol("nested-transaction");
  const { state } = store;
  for (;;) {
    await waitForScope(store);
    if (!outside(store.chain, state)) break;
  }
  const previous = state.owner;
  state.owner = id;
  const child: Store = { state, chain: [...store.chain, id] };
  const name = `guarded_tx_${++state.savepoints}`;
  try {
    await serialised(state, async () => {
      if (state.closed) throw state.closed;
      await state.tx.$executeRawUnsafe(`SAVEPOINT ${name}`).catch((error) => { state.closed = new GuardedWorkClosedError(error); throw state.closed; });
    });
    try {
      const value = await storage.run(child, () => fn(client));
      await serialised(state, async () => {
        if (state.closed) throw state.closed;
        await state.tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
      });
      return value;
    } catch (error) {
      if (!state.closed && !isClosedError(error)) {
        await serialised(state, async () => {
          await state.tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`).catch(() => undefined);
          await state.tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`).catch(() => undefined);
        });
      }
      throw error;
    }
  } finally {
    state.owner = previous;
    wake(state);
  }
}

function delegate(store: Store, model: Record<string, unknown>) {
  return new Proxy(model, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => statement(store, () => (value as (...a: unknown[]) => Promise<unknown>).apply(target, args));
    },
  });
}

/**
 * Wraps the application's client: outside guarded work it is the client itself; inside, every
 * model call, raw query and `$transaction` is redirected to the guard's transaction.
 */
export function guardedClient<T extends PrismaClient>(base: T): T {
  const proxy: T = new Proxy(base, {
    get(target, prop) {
      const store = storage.getStore();
      if (!store) {
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
      if (prop === "$transaction") return (arg: unknown) => nestedTransaction(store, proxy, arg);
      if (typeof prop === "string" && RAW.has(prop)) {
        return (...args: unknown[]) => statement(store, (tx) => (tx[prop as "$queryRaw"] as unknown as (...a: unknown[]) => Promise<unknown>)(...args));
      }
      if (typeof prop === "string" && !prop.startsWith("$")) {
        const model = Reflect.get(store.state.tx, prop) as unknown;
        if (model && typeof model === "object") return delegate(store, model as Record<string, unknown>);
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return proxy;
}

/**
 * Runs `work` as guarded work on a new interactive transaction of `base`. `setup` runs first on
 * the same transaction (take the guard's lock there).
 */
export function runGuarded<R>(base: PrismaClient, setup: (tx: Tx) => Promise<void>, work: () => Promise<R>, options: { timeout: number; maxWait?: number }): Promise<R> {
  return base.$transaction(async (tx) => {
    await setup(tx);
    const state: GuardState = { tx, closed: null, tail: Promise.resolve(), savepoints: 0, owner: null, waiters: [] };
    try {
      return await storage.run({ state, chain: [] }, work);
    } finally {
      // Anything still running after this point (an un-awaited continuation) must not write.
      state.closed ??= new GuardedWorkClosedError();
    }
  }, options);
}

/** Throws when called from guarded work whose transaction (and so its lock) has ended. */
export async function assertGuardedWorkActive() {
  const store = storage.getStore();
  if (!store) return;
  await statement(store, (tx) => tx.$queryRawUnsafe("SELECT 1"));
}

/** Whether the caller is inside guarded work (for diagnostics and tests). */
export const insideGuardedWork = () => storage.getStore() !== undefined;
