/**
 * True on every Vercel deployment — Preview and Production alike — but not for `vercel dev` run
 * locally (`VERCEL_ENV` is `"development"` there) or a plain local `next dev`/`next build`/test
 * run (neither `VERCEL` var is set at all). This is the one signal that actually distinguishes
 * "running on Vercel's serverless filesystem" from "running somewhere with a durable local disk",
 * which is what actually matters for the local-storage-fallback safety guard — not the
 * Preview/Production distinction itself. Shared by the registry (adapter selection) and the
 * S3 adapter (legacy single-bucket fallback eligibility).
 */
export function isCloudRuntime() {
  // Google Cloud Run sets K_SERVICE on every revision; its container disk is in-memory and lost when
  // the instance stops, so it is a cloud runtime for the same reason Vercel is.
  if (process.env.K_SERVICE) return true;
  return process.env.VERCEL === "1" && process.env.VERCEL_ENV !== "development";
}
