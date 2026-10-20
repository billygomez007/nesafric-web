/**
 * Imports canonical geography datasets (data/geography/**.json). Dry run by default: it prints
 * what would change and records the run, changing no reference data. Pass --apply to write the
 * safe changes; renames, re-parenting, re-coding and deactivations are held for review in the
 * platform admin (Geography > Imports) and never applied here.
 *
 *   npx tsx scripts/geography/import.ts data/geography/gh/hdx-cod-ab-admin.json [...more] [--apply]
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { importGeoDataset } from "../../src/modules/geography/importer";
import { db } from "../../src/platform/database/client";

async function main() {
  const apply = process.argv.includes("--apply");
  const files = process.argv.slice(2).filter((value) => !value.startsWith("--"));
  if (!files.length) throw new Error("Pass one or more dataset files.");
  const host = (() => { try { return new URL(process.env.DATABASE_URL ?? "").hostname; } catch { return "unknown"; } })();
  console.log(`${apply ? "APPLY" : "DRY RUN"} against database host ${host}`);
  for (const file of files) {
    const report = await importGeoDataset(JSON.parse(readFileSync(file, "utf8")), { apply });
    console.log(JSON.stringify({ file, run: report.runId, mode: report.mode, source: report.sourceId, counts: report.counts, warnings: report.warnings.slice(0, 10), held: report.held.slice(0, 20).map((change) => ({ action: change.action, entityId: change.entityId, reason: change.reason })) }, null, 2));
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => db.$disconnect());
