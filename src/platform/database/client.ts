import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/platform/database/generated/client";
import { guardedClient } from "./guarded";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Driver adapter (plain `pg`, no native query-engine binary) — sidesteps the native-binary
// bundling issues that affect serverless deployments with a custom Prisma generator output path.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

const base =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    // Optional override for operating against a database with meaningfully higher round-trip
    // latency than the application's normal deployment topology (e.g. running a one-off
    // maintenance/seed script from outside the app's own region) — unset leaves Prisma's own
    // defaults (2000ms/5000ms) untouched.
    transactionOptions: {
      maxWait: process.env.DB_TRANSACTION_MAX_WAIT_MS ? Number(process.env.DB_TRANSACTION_MAX_WAIT_MS) : undefined,
      timeout: process.env.DB_TRANSACTION_TIMEOUT_MS ? Number(process.env.DB_TRANSACTION_TIMEOUT_MS) : undefined,
    },
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = base;

/** The underlying client, never redirected (for starting guarded work). */
export const baseClient = base;

/**
 * The application's client. Inside guarded work (`runGuarded`) its calls run on the guard's
 * transaction; everywhere else it is the plain client.
 */
export const db = guardedClient(base);


