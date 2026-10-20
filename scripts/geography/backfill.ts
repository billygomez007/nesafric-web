/**
 * Links existing listings, properties and provider/professional coverage to reference areas.
 * Dry run by default (prints the report); --apply writes. See src/modules/geography/backfill.ts
 * for exactly what is and is not changed.
 *
 *   npx tsx scripts/geography/backfill.ts [--apply] [--country GH]
 */
import "dotenv/config";
import { backfillGeography } from "../../src/modules/geography/backfill";
import { db } from "../../src/platform/database/client";

async function main() {
  const apply = process.argv.includes("--apply");
  const index = process.argv.indexOf("--country");
  const countryCode = index >= 0 ? process.argv[index + 1] : "GH";
  const report = await backfillGeography({ apply, countryCode });
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => db.$disconnect());
