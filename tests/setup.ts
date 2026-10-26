import "dotenv/config";

// Deterministic, credential-free defaults for the automated test suite: the in-memory storage
// adapter avoids disk I/O and cross-run cleanup, and every other Phase 19 provider-neutral
// adapter already falls back to its deterministic/internal mode when its env vars are unset.
process.env.STORAGE_PROVIDER = "memory";

// Tenant access codes and sessions need a secret; CI sets one, a local run without .env would not.
process.env.SESSION_SECRET ||= "test-only-session-secret-not-a-real-secret-32chars";

// Webhook tests drive the job queue themselves; the post-response fast path needs a Next.js request.
process.env.WHATSAPP_INLINE_PROCESSING = "false";
