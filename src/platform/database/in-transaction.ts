import type { Prisma } from "@/platform/database/generated/client";

/**
 * Optional hook a domain service runs inside the transaction that creates or changes a record, so
 * a caller can commit its own bookkeeping (e.g. an idempotency binding) atomically with it. If the
 * hook throws, the whole transaction — the record included — rolls back.
 */
export type InTransaction<T> = (tx: Prisma.TransactionClient, record: T) => Promise<void>;
