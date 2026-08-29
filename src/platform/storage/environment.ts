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
  return process.env.VERCEL === "1" && process.env.VERCEL_ENV !== "development";
}
