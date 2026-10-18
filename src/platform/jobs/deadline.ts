import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The time by which the job currently running must be finished, when the runner gave it one (for
 * example the post-response fast path, which shares a serverless function's lifetime). Code that
 * holds resources for a long time, such as the WhatsApp processing guard, shortens its own limit
 * to fit, so it ends by itself instead of being killed with the function.
 */
const storage = new AsyncLocalStorage<{ at: number }>();

export function runWithJobDeadline<T>(at: number, work: () => Promise<T>) {
  return storage.run({ at }, work);
}

/** Milliseconds left before the current job's deadline, or null when it has none. */
export function remainingJobTimeMs(now = Date.now()) {
  const store = storage.getStore();
  return store ? store.at - now : null;
}

export class JobDeadlineExceededError extends Error {
  constructor(budgetMs: number) {
    super(`The job did not finish within its ${budgetMs} ms budget; it will be retried.`);
    this.name = "JobDeadlineExceededError";
  }
}
